import { z } from 'zod'
import type {
  AutomationApi,
  AutomationGrant,
  AutomationPreview,
  AutomationScope,
  AutomationCommit,
} from '@repeaty/plugin-api'
import type { LibraryContext, CommitOptions } from './library-context'
import type { AutomationIdentity, AutomationConsent } from '../plugins/automation'
import {
  AutomationQuerySchema,
  AutomationApplySchema,
  parseAutomationRequest,
  automationFingerprint,
  prepareAutomation,
  queryAutomation,
  emptyAutomationIds,
  type PreparedAutomation,
  type AutomationRequest,
} from '../core/automation'
import { canonicalAutomationValue, MAX_AUTOMATION_RECEIPTS } from '../core/automation-data'
import { operationFor, revertOperation, replayOperation } from '../core/operations'
import { operationHistory, MAX_OPERATION_HISTORY } from '../core/operation-history'
import { undoReview } from '../core/scheduler'
import { sourceAtVersion } from '../core/source-data'
import { noteLifecycle, type RetiredNote } from '../desktop/retirement'
import type { Library } from '../core/model'
import { hasAttemptBody } from '../core/practice-data'

const list = z.array(z.string().min(1).max(150)).min(1).max(1000)
const grantSchema = z.strictObject({
  scope: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('all') }),
    z.strictObject({ kind: z.literal('sources'), sourceIds: list }),
    z.strictObject({ kind: z.literal('folders'), folderIds: list }),
  ]),
  write: z.boolean(),
})
export class AutomationAccessError extends Error {
  constructor(readonly code: string) {
    super(code)
  }
}
const fail = (code: string): never => {
  throw new AutomationAccessError(code)
}
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  return result.success ? result.data : fail('invalid-arguments')
}
type Sets = {
  sources: Set<string>
  folders: Set<string>
  collections: Set<string>
  notes: Set<string>
  decks: Set<string>
  cards: Set<string>
}
function allowed(library: Library, scope: AutomationScope): Sets {
  const folders = new Set(scope.kind === 'folders' ? scope.folderIds : [])
  const sources = new Set(scope.kind === 'sources' ? scope.sourceIds : [])
  let changed = true
  while (changed) {
    changed = false
    for (const folder of library.materialFolders)
      if (!folders.has(folder.id) && folder.parentId && folders.has(folder.parentId)) {
        folders.add(folder.id)
        changed = true
      }
    for (const source of library.sources)
      if (
        !sources.has(source.id) &&
        ((source.folderId && folders.has(source.folderId)) ||
          (source.parentSourceId && sources.has(source.parentSourceId)))
      ) {
        sources.add(source.id)
        changed = true
      }
  }
  const notes = new Set(
    library.notes
      .filter((note) => note.excerpt && sources.has(note.excerpt.sourceId))
      .map((note) => note.id),
  )
  return {
    sources,
    folders,
    collections: new Set(),
    notes,
    decks: new Set(library.notes.filter((note) => notes.has(note.id)).map((note) => note.deckId)),
    cards: new Set(library.cards.filter((card) => notes.has(card.noteId)).map((card) => card.id)),
  }
}
function readable(library: Library, scope: AutomationScope): Library {
  if (scope.kind === 'all') return library
  const ids = allowed(library, scope)
  return {
    ...library,
    materialCollections: [],
    sources: library.sources.filter((v) => ids.sources.has(v.id)),
    materialFolders: library.materialFolders.filter((v) => ids.folders.has(v.id)),
    notes: library.notes.filter((v) => ids.notes.has(v.id)),
    cards: library.cards.filter((v) => ids.cards.has(v.id)),
    decks: library.decks.filter((v) => ids.decks.has(v.id)),
    reviews: library.reviews.filter((v) => ids.cards.has(v.cardId)),
    practices: library.practices.filter((v) => ids.cards.has(v.cardId)),
    studyEvents: library.studyEvents.filter(
      (v) => v.kind === 'reading' && 'sourceId' in v && ids.sources.has(v.sourceId as string),
    ),
  }
}
function assertChanges(
  before: Library,
  prepared: PreparedAutomation,
  request: AutomationRequest,
  scope: AutomationScope,
) {
  if (scope.kind === 'all') return
  const ids = allowed(before, scope),
    after = allowed(prepared.library, scope)
  for (const [entity, touched] of Object.entries(prepared.touched) as [keyof Sets, string[]][]) {
    const existing = new Set(
      (entity === 'folders'
        ? before.materialFolders
        : entity === 'collections'
          ? before.materialCollections
          : before[entity]
      ).map((v) => v.id),
    )
    if (touched.some((id) => (existing.has(id) ? !ids[entity].has(id) : !after[entity].has(id))))
      fail('permission-denied')
  }
  for (const command of request.commands) {
    if (
      command.kind.startsWith('history.') ||
      command.kind.startsWith('collection.') ||
      command.kind === 'checkpoint.restore' ||
      command.kind === 'retired.restore' ||
      command.kind === 'note.create' ||
      command.kind.startsWith('deck.')
    )
      fail('permission-denied')
    if (command.kind === 'note.move' || (command.kind === 'note.patch' && command.patch.deckId))
      fail('permission-denied')
    if (
      command.kind === 'source.move' ||
      command.kind === 'folder.move' ||
      command.kind === 'source.create'
    ) {
      const dest = command.destination
      if (!dest) return fail('permission-denied')
      if (!dest.folderId && !('parentSourceId' in dest && dest.parentSourceId))
        fail('permission-denied')
      if (dest.folderId && !ids.folders.has(dest.folderId)) fail('permission-denied')
      if ('parentSourceId' in dest && dest.parentSourceId && !ids.sources.has(dest.parentSourceId))
        fail('permission-denied')
      if (
        'beforeId' in command &&
        command.beforeId &&
        !ids.sources.has(command.beforeId) &&
        !ids.folders.has(command.beforeId)
      )
        fail('permission-denied')
    }
    if (
      command.kind === 'folder.create' &&
      (!command.parentId || !ids.folders.has(command.parentId))
    )
      fail('permission-denied')
    if (command.kind === 'note.patch' && (command.patch.frontMedia || command.patch.backMedia))
      fail('permission-denied')
  }
}
type Plan = {
  public: AutomationPreview
  prepared: PreparedAutomation
  options: CommitOptions
  grantId: string
  expires: number
  before: Library
}
/** One transaction port for CLI, MCP and installed assistants. Plans never carry client-owned state. */
export function createAutomationCommands(context: LibraryContext) {
  return {
    automationApi(owner: AutomationIdentity, consent: AutomationConsent): AutomationApi {
      const target = context.repository
      let grant: AutomationGrant | undefined
      let grantEpoch = 0
      const plans = new Map<string, Plan>()
      const current = (signal?: AbortSignal) => {
        owner.assertCurrent()
        owner.signal.throwIfAborted()
        signal?.throwIfAborted()
        if (
          !context.ready.value ||
          !owner.scope ||
          owner.scope !== context.scope.value ||
          target !== context.repository
        )
          fail('library-changed')
      }
      const access = (write = false, signal?: AbortSignal) => {
        current(signal)
        const value = consent.grant ? consent.grant() : grant
        if (!value || value.libraryScope !== owner.scope || (write && !value.write))
          return fail('permission-denied')
        return value
      }
      const revision = (expected: number, signal?: AbortSignal) => {
        current(signal)
        if (context.revision !== expected) fail('library-changed')
      }
      const fingerprint = async (request: AutomationRequest) => {
        const digest = await automationFingerprint(request)
        // Bind the preview and receipt to this library and actor, including across process restarts.
        const bytes = new TextEncoder().encode(
          canonicalAutomationValue([owner.scope, owner.actorId, digest]),
        )
        return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
          .map((v) => v.toString(16).padStart(2, '0'))
          .join('')
      }
      const receipt = (
        requestId: string,
        permitted: AutomationGrant,
        hash?: string,
      ): AutomationCommit | undefined => {
        const entry = context.library.value.automationReceipts.find(
          (v) => v.actorId === owner.actorId && v.requestId === requestId,
        )
        if (!entry) return
        if (hash && entry.fingerprint !== hash) fail('request-conflict')
        if (permitted.scope.kind !== 'all') {
          const ids = allowed(context.library.value, permitted.scope)
          for (const [entity, values] of Object.entries(entry.result.resultIds) as [
            keyof Sets,
            string[],
          ][])
            if (values.some((id) => !ids[entity].has(id))) fail('permission-denied')
        }
        return { ...structuredClone(entry.result), operationId: entry.operationId, replayed: true }
      }
      const summarize = (before: Library, next: Library): PreparedAutomation => {
        const touched = emptyAutomationIds(),
          resultIds = emptyAutomationIds(),
          changes: PreparedAutomation['changes'] = []
        const entry = operationFor(before, next, owner.scope, '整理材料')
        for (const change of entry?.changes ?? []) {
          const entity =
            change.store === 'materialFolders'
              ? 'folders'
              : change.store === 'materialCollections'
                ? 'collections'
                : change.store
          if (!(entity in touched)) continue
          const key = entity as keyof typeof touched
          touched[key].push(change.id)
          if (change.after) resultIds[key].push(change.id)
          changes.push({
            entity: key,
            id: change.id,
            action: !change.before ? 'create' : !change.after ? 'remove' : 'update',
            fields: change.keys,
          })
        }
        return { library: next, assets: [], touched, resultIds, changes }
      }
      const prepare = async (request: AutomationRequest, signal?: AbortSignal) => {
        const before = context.library.value,
          first = request.commands[0]!
        let options: CommitOptions = {},
          prepared: PreparedAutomation
        if (first.kind === 'checkpoint.restore') {
          const next = await target.getBackup(first.checkpointId)
          const retired =
            'retiredNotes' in target ? await target.retiredNotes(first.checkpointId) : undefined
          prepared = summarize(before, { ...next, automationReceipts: before.automationReceipts })
          options = { retired, undoBarrier: true }
        } else if (first.kind === 'retired.restore') {
          if (!('retiredNote' in target)) return fail('unsupported-operation')
          const prior = await target.retiredNote(first.noteId)
          if (!prior.note || before.notes.some((v) => v.id === first.noteId))
            return fail('not-found')
          prepared = summarize(
            before,
            noteLifecycle(before, prior.note, first.noteId, prior, true).library,
          )
        } else if (first.kind === 'history.undo' || first.kind === 'history.redo') {
          const redo = first.kind === 'history.redo'
          const entry = (redo ? context.redoOperations : context.operations).value.at(-1)
          if (!entry || entry.scope !== owner.scope) return fail('not-found')
          if (!redo && entry.kind === 'review' && entry.reviewId !== before.reviews.at(-1)?.id)
            return fail('library-changed')
          const next = redo
            ? replayOperation(before, entry)
            : entry.kind === 'review'
              ? undoReview(before)
              : revertOperation(before, entry)
          const replay =
            !redo && entry.kind === 'review'
              ? {
                  ...operationFor(next, before, owner.scope, entry.label, 'review')!,
                  id: entry.id,
                  createdAt: entry.createdAt,
                }
              : entry
          options = {
            undoLabel: false,
            operationHistory: redo
              ? operationHistory(
                  [...context.operations.value.slice(-(MAX_OPERATION_HISTORY - 1)), entry],
                  context.redoOperations.value.filter((v) => v.id !== entry.id),
                )
              : operationHistory(
                  context.operations.value.filter((v) => v.id !== entry.id),
                  [...context.redoOperations.value.slice(-19), replay],
                ),
          }
          prepared = summarize(before, next)
        } else {
          const retired = new Map<string, RetiredNote>()
          if ('retiredNote' in target)
            for (const command of request.commands)
              if (command.kind === 'note.patch')
                retired.set(command.noteId, await target.retiredNote(command.noteId))
          prepared = prepareAutomation(before, request, context.revision, new Date(), retired)
        }
        revision(request.expectedRevision, signal)
        // Verify objects needed by restoring/undoing before offering an applicable preview.
        for (const meta of prepared.library.media)
          if (
            !before.media.some((v) => v.id === meta.id) &&
            !prepared.assets.some((v) => v.meta.id === meta.id) &&
            !(await target.getMedia(meta.id))
          )
            fail('missing-media')
        revision(request.expectedRevision, signal)
        return { prepared, options, before }
      }
      owner.signal.addEventListener(
        'abort',
        () => {
          grant = undefined
          plans.clear()
        },
        { once: true },
      )
      const api: AutomationApi = {
        context() {
          current()
          return {
            sources: context.library.value.sources.map(
              ({ id, title, folderId, parentSourceId }) => ({
                id,
                title,
                folderId,
                parentSourceId,
              }),
            ),
            folders: context.library.value.materialFolders.map(({ id, name, parentId }) => ({
              id,
              name,
              parentId,
            })),
          }
        },
        capabilities() {
          current()
          const authorized = consent.grant ? consent.grant() : grant
          return {
            protocolVersion: 1,
            libraryScope: owner.scope,
            revision: context.revision,
            readEnabled: !!authorized,
            writeEnabled: !!authorized?.write,
            grant: authorized && structuredClone(authorized),
            retired: 'retiredNote' in target,
            checkpoints: true,
            maxBatch: 100,
            maxPage: 200,
          }
        },
        async authorize(raw) {
          current()
          const epoch = ++grantEpoch
          const input = parse(grantSchema, raw)
          const data = context.library.value
          if (
            input.scope.kind === 'sources' &&
            input.scope.sourceIds.some((id) => !data.sources.some((v) => v.id === id))
          )
            fail('not-found')
          if (
            input.scope.kind === 'folders' &&
            input.scope.folderIds.some((id) => !data.materialFolders.some((v) => v.id === id))
          )
            fail('not-found')
          if (!(await consent.authorize(owner, input))) return fail('permission-denied')
          current()
          if (epoch !== grantEpoch) return fail('permission-denied')
          grant = { ...input, id: crypto.randomUUID(), libraryScope: owner.scope }
          plans.clear()
          return structuredClone(grant)
        },
        revoke() {
          grantEpoch++
          grant = undefined
          plans.clear()
        },
        async query(raw, signal) {
          const permitted = access(false, signal),
            query = parse(AutomationQuerySchema, raw),
            expected = context.revision
          if (query.revision !== undefined) revision(query.revision, signal)
          if ('offset' in query && query.offset && query.revision === undefined)
            fail('library-changed')
          const library = readable(context.library.value, permitted.scope)
          if (query.kind === 'source.body') {
            const source = library.sources.find((v) => v.id === query.sourceId)
            const version = source && sourceAtVersion(source, query.versionId)
            if (!version) return fail('not-found')
            const text = await context.getSource(source!.id, signal, version.mediaId)
            if (access(false, signal).id !== permitted.id) fail('permission-denied')
            revision(expected, signal)
            return {
              revision: expected,
              sourceId: source!.id,
              versionId: version.mediaId,
              title: version.title,
              format: version.format,
              text,
            }
          }
          if (query.kind === 'retired' || query.kind === 'checkpoints') {
            if (permitted.scope.kind !== 'all') return fail('permission-denied')
            const items =
              query.kind === 'checkpoints'
                ? await target.listBackups()
                : 'retiredNotes' in target
                  ? (await target.retiredNotes())
                      .filter((v) => v.note)
                      .map((v) => ({
                        id: v.note!.id,
                        title: v.note!.front,
                        deckId: v.note!.deckId,
                        cards: v.cards.length,
                      }))
                  : []
            if (access(false, signal).id !== permitted.id) fail('permission-denied')
            revision(expected, signal)
            return {
              revision: expected,
              total: items.length,
              offset: query.offset,
              limit: query.limit,
              items: items.slice(query.offset, query.offset + query.limit),
              nextOffset:
                query.offset + query.limit < items.length ? query.offset + query.limit : undefined,
            }
          }
          return queryAutomation(library, expected, query)
        },
        async preview(raw, signal) {
          const permitted = access(true, signal),
            request = parseAutomationRequest(raw)
          revision(request.expectedRevision, signal)
          const hash = await fingerprint(request)
          if (access(true, signal).id !== permitted.id) fail('permission-denied')
          revision(request.expectedRevision, signal)
          const existing = [...plans.values()].find(
            (p) =>
              p.public.fingerprint === hash && p.grantId === permitted.id && p.expires > Date.now(),
          )
          if (existing) return structuredClone(existing.public)
          for (const [id, plan] of plans) if (plan.expires < Date.now()) plans.delete(id)
          if (plans.size >= 8) return fail('preview-limit')
          const planned = await prepare(request, signal)
          if (access(true, signal).id !== permitted.id) fail('permission-denied')
          assertChanges(planned.before, planned.prepared, request, permitted.scope)
          const value: AutomationPreview = {
            planId: crypto.randomUUID(),
            fingerprint: hash,
            request,
            revision: context.revision,
            changes: planned.prepared.changes,
            touched: planned.prepared.touched,
            resultIds: planned.prepared.resultIds,
          }
          plans.set(value.planId, {
            ...planned,
            public: value,
            grantId: permitted.id,
            expires: Date.now() + 10 * 60_000,
          })
          return structuredClone(value)
        },
        async operationStatus(id, signal) {
          const permitted = access(false, signal)
          return receipt(id, permitted)
        },
        async apply(raw, signal) {
          const permitted = access(true, signal),
            input = parse(AutomationApplySchema, raw),
            hash = await fingerprint(input.request)
          if (access(true, signal).id !== permitted.id) fail('permission-denied')
          if (hash !== input.fingerprint) return fail('request-conflict')
          const prior = receipt(input.request.operationId, permitted, hash)
          if (prior) return prior
          const plan = input.planId
            ? plans.get(input.planId)
            : [...plans.values()].find((v) => v.public.fingerprint === hash)
          if (!plan || plan.expires < Date.now() || plan.public.fingerprint !== hash)
            return fail('preview-required')
          if (plan.grantId !== permitted.id) return fail('permission-denied')
          revision(input.request.expectedRevision, signal)
          if (consent.apply && !(await consent.apply(owner, structuredClone(plan.public))))
            return fail('cancelled')
          revision(input.request.expectedRevision, signal)
          const operationId = crypto.randomUUID(),
            result = { revision: context.revision + 1, resultIds: plan.prepared.resultIds }
          const entry = operationFor(plan.before, plan.prepared.library, owner.scope, '整理材料')
          if (entry) entry.id = operationId
          // Deleted attempt bodies are hydrated only for this explicit automation transaction.
          for (const change of entry?.changes ?? [])
            if (
              change.store === 'attempts' &&
              change.before &&
              !change.after &&
              !hasAttemptBody(change.before as import('../core/practice-data').AttemptRecord)
            )
              change.before = await target.getAttempt(change.id, input.request.expectedRevision)
          const options: CommitOptions = {
            ...plan.options,
            assets: plan.prepared.assets,
            reason: '自动化修改前',
            backgroundMetadata: true,
            undoLabel: false,
            ...(plan.options.undoBarrier || plan.options.operationHistory
              ? {}
              : {
                  operationHistory: entry
                    ? operationHistory([
                        ...context.operations.value.slice(-(MAX_OPERATION_HISTORY - 1)),
                        entry,
                      ])
                    : operationHistory(context.operations.value, context.redoOperations.value),
                }),
          }
          await context.commit((currentLibrary) => {
            if (access(true, signal).id !== permitted.id) fail('permission-denied')
            revision(input.request.expectedRevision, signal)
            if (currentLibrary !== plan.before) fail('library-changed')
            assertChanges(currentLibrary, plan.prepared, input.request, permitted.scope)
            if (currentLibrary.automationReceipts.length >= MAX_AUTOMATION_RECEIPTS)
              fail('receipt-limit')
            return {
              ...plan.prepared.library,
              automationReceipts: [
                ...currentLibrary.automationReceipts,
                {
                  id: crypto.randomUUID(),
                  actorId: owner.actorId,
                  requestId: input.request.operationId,
                  fingerprint: hash,
                  operationId,
                  result,
                  createdAt: new Date().toISOString(),
                },
              ],
            }
          }, options)
          plans.delete(plan.public.planId)
          // A cancellation after the durable write cannot turn success into a retryable failure.
          return { ...structuredClone(result), operationId, replayed: false }
        },
      }
      return api
    },
  }
}
