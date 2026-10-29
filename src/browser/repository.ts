import {
  cardViews,
  workspaceLibrarySchema,
  librarySchema,
  cardSchema,
  reviewSchema,
  type Library,
  type MediaUpload,
  type SearchFilter,
} from '../core/model'
import {
  attemptSchema,
  hasAttemptBody,
  sameAttemptSummary,
  summarizeAttempt,
  type Attempt,
  type AttemptRecord,
} from '../core/practice-data'
import type { Snapshot, AutoBackup, BackupSummary, CardPage } from '../core/storage'
import { MAX_AUTO_BACKUPS } from '../core/storage'
import { compileSearch } from '../core/search'
import { available } from '../core/scheduler'
import { validateSourceOrigins } from '../core/sources'
import { validateMaterialChanges } from '../core/material-data'
import { LocalizedError, msg } from '../i18n'
import { WorkspaceReadError } from './errors'
import type { BrowserWorkspaceSnapshot } from './workspace-reader'
import {
  checkSourceDraftVersion,
  sourceDraftSchema,
  type SourceDraft,
} from '../core/source-workbench'

export interface BrowserWorkspaceSource {
  snapshot: BrowserWorkspaceSnapshot
  media(id: string): Promise<Blob | undefined>
  attempts(ids: string[]): Promise<Attempt[]>
  close(): void
}

/** A page-lifetime copy. File handles and the original SQLite never receive writes. */
export function createBrowserRepository(
  source: BrowserWorkspaceSource,
  onChange: () => void = () => {},
) {
  const scope = `local:web-workspace:${crypto.randomUUID()}`
  const original = source.snapshot.library
  const baselineMedia = new Map(original.media.map((item) => [item.id, item]))
  // A read-only trial can also undo a deletion saved by the desktop app.
  for (const entry of [
    ...(source.snapshot.operationHistory?.undo ?? []),
    ...(source.snapshot.operationHistory?.redo ?? []),
  ])
    for (const change of entry.changes)
      if (change.store === 'media')
        for (const value of [change.before, change.after])
          if (value) baselineMedia.set(value.id, value as Library['media'][number])
  let bodies = new WeakMap<AttemptRecord, Attempt>()
  const blobs = new Map<string, Blob>()
  const drafts = new Map<string, SourceDraft>(
    (source.snapshot.sourceDrafts ?? []).map((draft) => [
      draft.sourceId,
      sourceDraftSchema.parse({ ...draft, scope }),
    ]),
  )
  const backups: AutoBackup[] = []
  let current: Snapshot = {
    revision: source.snapshot.revision,
    library: original,
    operationHistory: source.snapshot.operationHistory,
  }
  let closed = false
  const check = (revision?: number) => {
    if (closed) throw new WorkspaceReadError('closed')
    if (revision !== undefined && revision !== current.revision)
      throw new LocalizedError(msg('学习库内容已变化，请重新载入。'))
  }
  async function media(id: string) {
    check()
    const blob = blobs.get(id) ?? (await source.media(id))
    check()
    return blob
  }
  async function expand(records: AttemptRecord[], signal?: AbortSignal) {
    signal?.throwIfAborted()
    check()
    const missing = records.filter((record) => !hasAttemptBody(record) && !bodies.has(record))
    const loaded = new Map<string, Attempt>()
    for (let offset = 0; offset < missing.length; offset += 128) {
      const batch = await source.attempts(missing.slice(offset, offset + 128).map((row) => row.id))
      for (const value of batch) loaded.set(value.id, attemptSchema.parse(value))
      check()
      signal?.throwIfAborted()
    }
    return records.map((record) => {
      const value = hasAttemptBody(record) ? record : (bodies.get(record) ?? loaded.get(record.id))
      if (!value || !sameAttemptSummary(record, value)) throw new WorkspaceReadError('invalid')
      bodies.set(record, value)
      return value
    })
  }
  function backup(reason: string, force: boolean, now = new Date()) {
    check()
    if (
      backups.some((entry) => entry.revision === current.revision) ||
      (!force &&
        backups[0] &&
        now.getTime() - new Date(backups[0].createdAt).getTime() < 30 * 60_000)
    )
      return
    backups.unshift({ ...current, id: crypto.randomUUID(), createdAt: now.toISOString(), reason })
    backups.splice(MAX_AUTO_BACKUPS)
  }
  return {
    scope: () => scope,
    async load(): Promise<Snapshot> {
      check()
      return current
    },
    async save(
      library: Library,
      expectedRevision: number,
      options: {
        assets?: MediaUpload[]
        reason?: string
        consumeCardDraft?: string
        consumeSourceDraft?: string
        operationHistory?: OperationHistory
      } = {},
    ): Promise<Snapshot> {
      check(expectedRevision)
      const operationHistory =
        options.operationHistory === undefined
          ? current.operationHistory
          : parseOperationHistory(options.operationHistory)
      if (options.consumeCardDraft) throw new WorkspaceReadError('invalid')
      const consumedDraft = options.consumeSourceDraft
        ? [...drafts.values()].find((draft) => draft.id === options.consumeSourceDraft)
        : undefined
      if (options.consumeSourceDraft && !consumedDraft) throw new WorkspaceReadError('invalid')
      const before = current.library
      validateMaterialChanges(before, library)
      const progressOnly =
        (
          [
            'decks',
            'notes',
            'media',
            'savedSearches',
            'sources',
            'practices',
            'attempts',
            'materialReceipts',
            'materialFolders',
          ] as const
        ).every((key) => library[key] === before[key]) &&
        library.cards.length === before.cards.length
      let next = library
      if (progressOnly) {
        const previous = new Map(before.cards.map((card) => [card.id, card]))
        const ids = new Set<string>()
        for (const card of library.cards) {
          const prior = previous.get(card.id)
          if (
            !prior ||
            prior.noteId !== card.noteId ||
            prior.variant !== card.variant ||
            ids.has(card.id)
          )
            throw new WorkspaceReadError('invalid')
          ids.add(card.id)
          if (prior !== card) cardSchema.parse(card)
        }
        if (library.reviews.length > 500_000) throw new WorkspaceReadError('limit')
        // Grading appends a review; undo removes one. No code bodies or media reads here.
        const old = new Set(before.reviews)
        const reviewIds = new Set<string>()
        for (const review of library.reviews) {
          if (reviewIds.has(review.id)) throw new WorkspaceReadError('invalid')
          reviewIds.add(review.id)
          if (!old.has(review)) {
            reviewSchema.parse(review)
            if (
              !ids.has(review.cardId) ||
              (review.practiceId &&
                !library.practices.some(
                  (practice) =>
                    practice.id === review.practiceId && practice.cardId === review.cardId,
                ))
            )
              throw new WorkspaceReadError('invalid')
          }
        }
      } else next = workspaceLibrarySchema.parse(library)
      const uploads = new Map<string, Blob>()
      for (const asset of options.assets ?? []) {
        const meta = next.media.find((entry) => entry.id === asset.meta.id)
        if (!meta) continue
        if (uploads.has(meta.id) || blobs.has(meta.id) || baselineMedia.has(meta.id))
          throw new LocalizedError(msg('媒体 ID 冲突，未覆盖已有文件。'))
        if (asset.blob.size !== meta.size || asset.blob.type !== meta.type)
          throw new WorkspaceReadError('invalid')
        uploads.set(meta.id, asset.blob)
      }
      for (const meta of next.media) {
        const baseline = baselineMedia.get(meta.id)
        const blob = uploads.get(meta.id) ?? blobs.get(meta.id)
        if (
          blob
            ? blob.size !== meta.size || blob.type !== meta.type
            : !baseline || baseline.size !== meta.size || baseline.type !== meta.type
        )
          throw new WorkspaceReadError('invalid')
      }
      const changedSources = new Set(
        next.sources
          .filter((source) => {
            const prior = before.sources.find((row) => row.id === source.id)
            return (
              !prior ||
              prior.mediaId !== source.mediaId ||
              prior.format !== source.format ||
              prior.characters !== source.characters ||
              prior.kind !== source.kind ||
              JSON.stringify(prior.origin) !== JSON.stringify(source.origin)
            )
          })
          .map((source) => source.id),
      )
      if (changedSources.size)
        await validateSourceOrigins(
          next,
          changedSources,
          async (id) => uploads.get(id) ?? media(id),
        )
      if (next.attempts !== before.attempts) {
        const oldAttempts = new Map(before.attempts.map((row) => [row.id, row]))
        next = {
          ...next,
          attempts: next.attempts.map((attempt) => {
            if (hasAttemptBody(attempt)) {
              const full = attemptSchema.parse(attempt),
                summary = summarizeAttempt(full)
              bodies.set(summary, full)
              return summary
            }
            const prior = oldAttempts.get(attempt.id)
            if (!prior || !sameAttemptSummary(prior, attempt))
              throw new WorkspaceReadError('invalid')
            const full = bodies.get(prior)
            if (full) bodies.set(attempt, full)
            return attempt
          }),
        }
      }
      check(expectedRevision)
      backup(options.reason ?? '自动备份', Boolean(options.reason))
      for (const [id, blob] of uploads) blobs.set(id, blob)
      current = { revision: expectedRevision + 1, library: next, operationHistory }
      if (consumedDraft) drafts.delete(consumedDraft.sourceId)
      onChange()
      return current
    },
    async getAttempt(id: string, expectedRevision = current.revision, signal?: AbortSignal) {
      check(expectedRevision)
      const record = current.library.attempts.find((entry) => entry.id === id)
      if (!record) throw new LocalizedError(msg('提交记录已不存在，请刷新后重试。'))
      const [body] = await expand([record], signal)
      check(expectedRevision)
      return body!
    },
    async readAttemptBatch(offset: number, expectedRevision: number, signal?: AbortSignal) {
      check(expectedRevision)
      const records = current.library.attempts.slice(offset, offset + 128)
      const result = await expand(records, signal)
      check(expectedRevision)
      return result
    },
    async completeLibrary() {
      check()
      const snapshot = current
      const attempts = await expand(snapshot.library.attempts)
      check(snapshot.revision)
      return librarySchema.parse({ ...snapshot.library, attempts })
    },
    async backupNow(force = false, now = new Date()) {
      backup(force ? '手动快照' : '自动备份', force, now)
    },
    async listBackups(): Promise<BackupSummary[]> {
      check()
      return backups.map(({ library, ...entry }) => ({
        ...entry,
        cards: library.cards.length,
        notes: library.notes.length,
      }))
    },
    async getBackup(id: string): Promise<Library> {
      check()
      const entry = backups.find((item) => item.id === id)
      if (!entry) throw new LocalizedError(msg('该快照已被清理，请重新打开备份列表。'))
      return librarySchema.parse({
        ...entry.library,
        attempts: await expand(entry.library.attempts),
      })
    },
    async queryCards(
      filter: SearchFilter,
      page = 1,
      now = new Date(),
      includeStudy = true,
      signal?: AbortSignal,
    ): Promise<CardPage> {
      check()
      signal?.throwIfAborted()
      const matches = compileSearch(current.library.decks, filter, now)
      const cards = cardViews(current.library).filter(matches)
      const eligible = includeStudy ? cards.filter((card) => available(card, now)) : []
      const offset = (Math.max(1, page) - 1) * 50
      return {
        cards: cards.slice(offset, offset + 50),
        total: cards.length,
        eligible: eligible.length,
        studyIds: eligible.slice(0, 500).map((card) => card.id),
      }
    },
    getMedia: media,
    async readSourceProperties(sourceId: string) {
      check()
      if (!current.library.sources.some((source) => source.id === sourceId))
        throw new WorkspaceReadError('invalid')
      return source.snapshot.sourceProperties?.[sourceId] ?? ''
    },
    async readSourceDraft(sourceId: string) {
      check()
      const draft = drafts.get(sourceId)
      return draft ? sourceDraftSchema.parse(draft) : undefined
    },
    async writeSourceDraft(input: SourceDraft) {
      check()
      const draft = sourceDraftSchema.parse(input)
      if (draft.scope !== scope) throw new WorkspaceReadError('invalid')
      checkSourceDraftVersion(
        current.library.sources.find((source) => source.id === draft.sourceId),
        draft,
      )
      if (!drafts.has(draft.sourceId) && drafts.size >= 50)
        throw new Error('材料草稿已达到 50 份上限。')
      drafts.set(draft.sourceId, draft)
    },
    async discardSourceDraft(sourceId: string, id: string) {
      check()
      if (drafts.get(sourceId)?.id === id) drafts.delete(sourceId)
    },
    async close() {
      if (closed) return
      closed = true
      source.close()
      bodies = new WeakMap()
      blobs.clear()
      drafts.clear()
      backups.splice(0)
    },
  }
}
import { parseOperationHistory, type OperationHistory } from '../core/operation-history'
