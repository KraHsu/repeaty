import { z } from 'zod'
import {
  cardViews,
  librarySchema,
  workspaceLibrarySchema,
  validateLibraryReferences,
  recordSchemas,
  type Library,
  type MediaUpload,
  type SearchFilter,
} from '../core/model'
import {
  attemptSchema,
  hasAttemptBody,
  summarizeAttempt,
  type Attempt,
} from '../core/practice-data'
import { cardDraftSchema, type CardDraft } from '../core/card-draft-data'
import { recordStores, type Snapshot, type BackupSummary, type CardPage } from '../core/storage'
import { compileSearch } from '../core/search'
import { available } from '../core/scheduler'
import {
  createWorkspaceMarkdown,
  readWorkspaceMarkdown,
  rewriteWorkspaceContent,
  type JsonObject,
} from '../workspace/markdown'
import {
  workspaceApi,
  workspaceAttention,
  nativeError,
  type ActiveWorkspace,
  type NativeApi,
} from './workspaces'
export type NativePatch = {
  store: (typeof recordStores)[number]
  id: string
  position?: number
  value?: unknown
}
export interface AcceptedDocument {
  kind: 'note' | 'source'
  id: string
  path: string
  hash: string
  raw: string
}
export interface DocumentWrite {
  kind: 'note' | 'source'
  id: string
  path: string
  raw: string | null
  expectedHash: string | null
  workingHash?: string
}
const docSchema = z.object({
  kind: z.enum(['note', 'source']),
  id: z.string(),
  path: z.string(),
  hash: z.string(),
  raw: z.string(),
})
export function encodeBytes(bytes: Uint8Array) {
  let binary = ''
  for (let at = 0; at < bytes.length; at += 32768)
    binary += String.fromCharCode(...bytes.subarray(at, at + 32768))
  return btoa(binary)
}
export function decodeBlob(value: { type: string; body: string }) {
  return new Blob([Uint8Array.from(atob(value.body), (c) => c.charCodeAt(0))], { type: value.type })
}
export function createNativeRepository(active: ActiveWorkspace, api: NativeApi = workspaceApi) {
  let cached: Snapshot | undefined
  const read = <T>(request: unknown) => api<T>('workspace_read', { token: active.token, request })
  const write = <T>(request: unknown) => api<T>('workspace_write', { token: active.token, request })
  const changed = () => nativeError('revision-conflict')
  async function documents(ids: string[]) {
    return z.array(docSchema).parse(await read({ type: 'documents', ids }))
  }
  async function media(id: string) {
    const result = await read<{ type: string; body: string } | null>({ type: 'media', id })
    return result ? decodeBlob(result) : undefined
  }
  async function upload(asset: MediaUpload) {
    if (asset.blob.size !== asset.meta.size || asset.blob.type !== asset.meta.type)
      throw nativeError('invalid-data')
    await write({
      type: 'media',
      id: asset.meta.id,
      mime: asset.blob.type,
      body: encodeBytes(new Uint8Array(await asset.blob.arrayBuffer())),
    })
  }
  async function serializeDraft(entry: CardDraft) {
    const draft = cardDraftSchema.parse(entry)
    if (draft.scope !== `local:workspace:${active.id}`) throw changed()
    for (const asset of draft.uploads) await upload(asset)
    return { ...draft, uploads: draft.uploads.map(({ meta }) => ({ meta })) }
  }
  const repository = {
    scope: () => `local:workspace:${active.id}`,
    async load(): Promise<Snapshot> {
      const result = await read<Snapshot>({ type: 'load' })
      if (!Number.isSafeInteger(result.revision) || result.revision < 0) throw changed()
      cached = { revision: result.revision, library: workspaceLibrarySchema.parse(result.library) }
      return cached
    },
    async save(
      library: Library,
      expectedRevision: number,
      options: {
        assets?: MediaUpload[]
        reason?: string
        consumeCardDraft?: string
        externalDocuments?: DocumentWrite[]
      } = {},
    ): Promise<Snapshot> {
      if (!cached) await repository.load()
      if (cached!.revision !== expectedRevision) throw changed()
      const previous = cached!.library
      const structural = !(['decks', 'notes', 'media', 'savedSearches', 'sources'] as const).every(
        (key) => previous[key] === library[key],
      )
      if (structural) workspaceLibrarySchema.parse(library)
      else
        validateLibraryReferences(library, () => {
          throw nativeError('invalid-data')
        })
      const patches: NativePatch[] = []
      for (const store of recordStores) {
        if (previous[store] === library[store]) continue
        const prior = new Map(
          previous[store].map((value, position) => [value.id, { value, position }]),
        )
        for (const [position, value] of library[store].entries()) {
          const old = prior.get(value.id)
          const same =
            old && (old.value === value || JSON.stringify(old.value) === JSON.stringify(value))
          if (!same || old.position !== position) {
            // Retain complete code when a compact attempt only moves position.
            const complete =
              store === 'attempts' && same && !hasAttemptBody(value as Attempt)
                ? await repository.getAttempt(value.id, expectedRevision)
                : value
            patches.push({
              store,
              id: value.id,
              position,
              value: recordSchemas[store].parse(complete),
            })
          }
          prior.delete(value.id)
        }
        for (const id of prior.keys()) patches.push({ store, id })
      }
      for (const asset of options.assets ?? [])
        if (library.media.some((meta) => meta.id === asset.meta.id)) await upload(asset)
      const contentPatches = patches.filter((patch) => {
        if (patch.store === 'notes') return true
        if (patch.store !== 'sources') return false
        const before = previous.sources.find((entry) => entry.id === patch.id)
        const after = patch.value as Library['sources'][number] | undefined
        return (
          !before ||
          !after ||
          !['title', 'url', 'mediaId', 'format', 'kind', 'origin'].every(
            (key) =>
              JSON.stringify(before[key as keyof typeof before]) ===
              JSON.stringify(after[key as keyof typeof after]),
          )
        )
      })
      const accepted = new Map(
        (contentPatches.length ? await documents(contentPatches.map((patch) => patch.id)) : []).map(
          (doc) => [`${doc.kind}:${doc.id}`, doc],
        ),
      )
      const overrides = new Map(
        (options.externalDocuments ?? []).map((doc) => [`${doc.kind}:${doc.id}`, doc]),
      )
      const mediaIds = [
        ...new Set(
          contentPatches.flatMap((patch) =>
            patch.store === 'notes' && patch.value
              ? [
                  ...(patch.value as Library['notes'][number]).frontMedia,
                  ...(patch.value as Library['notes'][number]).backMedia,
                ]
              : [],
          ),
        ),
      ]
      const assetPaths = mediaIds.length
        ? await read<Record<string, string>>({ type: 'asset-paths', ids: mediaIds })
        : {}
      const attachment = (id: string) => {
        const path = assetPaths[id]
        if (!path) throw nativeError('not-found')
        return { id, path }
      }
      const writes: DocumentWrite[] = []
      for (const patch of contentPatches) {
        const kind = patch.store === 'notes' ? 'note' : 'source'
        const old = accepted.get(`${kind}:${patch.id}`)
        const override = overrides.get(`${kind}:${patch.id}`)
        if (override) {
          writes.push(override)
          continue
        }
        let raw: string | null = null
        if (patch.value) {
          const value = patch.value as Library['notes'][number] & Library['sources'][number]
          const header: Record<string, unknown> = {
            version: 1,
            kind,
            id: value.id,
            format: value.format,
          }
          const properties: Record<string, unknown> = { repeaty: header }
          let content:
            { kind: 'note'; front: string; back: string } | { kind: 'source'; body: string }
          if (kind === 'note') {
            Object.assign(header, {
              type: value.type,
              deckId: value.deckId,
              frontMedia: value.frontMedia.map(attachment),
              backMedia: value.backMedia.map(attachment),
              ...(value.plugin ? { plugin: value.plugin } : {}),
            })
            properties.tags = value.tags
            content = { kind: 'note', front: value.front, back: value.back }
          } else {
            properties.title = value.title
            properties.url = value.url
            const asset =
              (options.assets ?? []).find((asset) => asset.meta.id === value.mediaId)?.blob ??
              (await media(value.mediaId))
            if (!asset) throw nativeError('not-found')
            content = { kind: 'source', body: await asset.text() }
          }
          const parsed = old ? readWorkspaceMarkdown(old.raw) : undefined
          if (parsed?.status === 'managed') {
            const existing = parsed.document
            const sameHeader = Object.entries(header).every(
              ([key, value]) => JSON.stringify(existing.header[key]) === JSON.stringify(value),
            )
            const sameProperties = Object.entries(properties)
              .filter(([key]) => key !== 'repeaty')
              .every(
                ([key, value]) =>
                  JSON.stringify(existing.properties[key]) === JSON.stringify(value),
              )
            if (sameHeader && sameProperties) {
              try {
                raw = rewriteWorkspaceContent(existing, content)
              } catch {
                raw = createWorkspaceMarkdown(
                  {
                    ...existing.properties,
                    ...properties,
                    repeaty: { ...existing.header, ...header },
                  } as JsonObject,
                  content,
                )
              }
            } else
              raw = createWorkspaceMarkdown(
                {
                  ...existing.properties,
                  ...properties,
                  repeaty: { ...existing.header, ...header },
                } as JsonObject,
                content,
              )
          } else raw = createWorkspaceMarkdown(properties as JsonObject, content)
        }
        if (!old && !patch.value) continue
        writes.push({
          kind,
          id: patch.id,
          path: old?.path ?? `${kind === 'note' ? 'notes' : 'sources'}/${crypto.randomUUID()}.md`,
          raw,
          expectedHash: old?.hash ?? null,
        })
      }
      const result = await write<{
        revision: number
        attention: { path: string; status: string }[]
      }>({
        type: 'commit',
        input: {
          operationId: crypto.randomUUID(),
          expectedRevision,
          patches,
          documents: writes,
          reason: options.reason ?? null,
          consumeCardDraft: options.consumeCardDraft ?? null,
        },
      })
      if (result.revision !== expectedRevision + 1) throw changed()
      workspaceAttention.value = result.attention
      cached = {
        revision: result.revision,
        library: library.attempts.some(hasAttemptBody)
          ? {
              ...library,
              attempts: library.attempts.map((entry) =>
                hasAttemptBody(entry) ? summarizeAttempt(entry) : entry,
              ),
            }
          : library,
      }
      return cached
    },
    async getAttempt(id: string, expectedRevision = cached?.revision, signal?: AbortSignal) {
      signal?.throwIfAborted()
      if (expectedRevision !== cached?.revision) throw changed()
      const value = z
        .object({ revision: z.number(), attempts: z.array(attemptSchema).length(1) })
        .parse(
          await read({ type: 'attempts', input: { mode: 'one', id, revision: expectedRevision } }),
        )
      signal?.throwIfAborted()
      if (value.revision !== expectedRevision || value.attempts[0]!.id !== id) throw changed()
      return value.attempts[0]!
    },
    async readAttemptBatch(offset: number, expectedRevision: number, signal?: AbortSignal) {
      signal?.throwIfAborted()
      if (expectedRevision !== cached?.revision) throw changed()
      const value = z
        .object({ revision: z.number(), attempts: z.array(attemptSchema).max(128) })
        .parse(
          await read({
            type: 'attempts',
            input: { mode: 'batch', offset, revision: expectedRevision },
          }),
        )
      signal?.throwIfAborted()
      if (
        value.revision !== expectedRevision ||
        value.attempts.some(
          (entry, index) => entry.id !== cached!.library.attempts[offset + index]?.id,
        )
      )
        throw changed()
      return value.attempts
    },
    async completeLibrary() {
      if (!cached) await repository.load()
      const { revision, library } = cached!
      const attempts: Attempt[] = []
      while (attempts.length < library.attempts.length) {
        const batch = await repository.readAttemptBatch(attempts.length, revision)
        if (!batch.length) throw changed()
        attempts.push(...batch)
      }
      return librarySchema.parse({ ...library, attempts })
    },
    getMedia: media,
    async backupNow(force = false, _now?: Date) {
      await write({ type: 'backup', force })
    },
    listBackups: () => read<BackupSummary[]>({ type: 'backups' }),
    async getBackup(id: string) {
      return librarySchema.parse(await read({ type: 'backup', id }))
    },
    async queryCards(
      filter: SearchFilter,
      page = 1,
      now = new Date(),
      includeStudy = true,
      signal?: AbortSignal,
    ): Promise<CardPage> {
      signal?.throwIfAborted()
      if (!cached) await repository.load()
      const matches = compileSearch(cached!.library.decks, filter, now)
      const cards = cardViews(cached!.library).filter(matches)
      const eligible = includeStudy ? cards.filter((card) => available(card, now)) : []
      return {
        cards: cards.slice((Math.max(1, page) - 1) * 50, Math.max(1, page) * 50),
        total: cards.length,
        eligible: eligible.length,
        studyIds: eligible.slice(0, 500).map((card) => card.id),
      }
    },
    async readCardDrafts() {
      const rows = await read<Record<string, unknown>[]>({ type: 'drafts' })
      return Promise.all(
        rows.map(async (value) => {
          const uploads = await Promise.all(
            (value.uploads as { meta: MediaUpload['meta'] }[]).map(async ({ meta }) => {
              const blob = await media(meta.id)
              if (!blob) throw nativeError('not-found')
              return { meta, blob }
            }),
          )
          return cardDraftSchema.parse({ ...value, uploads })
        }),
      )
    },
    async addCardDrafts(entries: CardDraft[]) {
      await write({ type: 'draft-add', entries: await Promise.all(entries.map(serializeDraft)) })
    },
    async updateCardDraft(entry: CardDraft) {
      await write({ type: 'draft-update', entries: [await serializeDraft(entry)] })
    },
    async discardCardDraft(id: string) {
      await write({ type: 'draft-remove', id })
    },
    async close() {
      cached = undefined
    },
  }
  return repository
}
