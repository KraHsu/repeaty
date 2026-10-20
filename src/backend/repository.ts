import { api as request, apiJson as requestJson, ServerError } from './client'
import {
  cardViews,
  librarySchema,
  workspaceLibrarySchema,
  validateLibraryReferences,
  recordSchemas,
  migrateLibrary,
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
import { z } from 'zod'
import { compileSearch } from '../core/search'
import { available } from '../core/scheduler'
import { recordStores, type Snapshot, type BackupSummary, type CardPage } from '../core/storage'

type Patch = { store: string; id: string; position?: number; value?: unknown }
export function createServerRepository(source = location.origin) {
  let cached: Snapshot | undefined
  let userId = ''
  let compactHistory = false
  async function api(path: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers)
    headers.set('X-Repeaty-User', userId)
    return request(path, { ...init, headers })
  }
  async function apiJson<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    const response = await api(
      path,
      body === undefined
        ? { signal }
        : {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal,
          },
    )
    return response.status === 204 ? (undefined as T) : (response.json() as Promise<T>)
  }
  return {
    scope: () => `${source}:${userId}`,
    async load(): Promise<Snapshot> {
      const status = await requestJson<{ apiVersion: number; historyVersion?: number }>('/status')
      if (status.apiVersion !== 5) throw new ServerError('incompatible-version')
      compactHistory = status.historyVersion === 1
      if (!userId) userId = (await requestJson<{ user: { id: string } }>('/auth/session')).user.id
      const saved = await apiJson<Snapshot>(compactHistory ? '/library/summary' : '/library')
      if (!Number.isSafeInteger(saved.revision) || saved.revision < 0)
        throw new ServerError('invalid-data')
      cached = {
        revision: saved.revision,
        library: compactHistory
          ? workspaceLibrarySchema.parse(saved.library)
          : migrateLibrary(saved.library),
      }
      return cached
    },
    async save(
      library: Library,
      expectedRevision: number,
      options: { assets?: MediaUpload[]; reason?: string } = {},
    ): Promise<Snapshot> {
      if (!cached) await this.load()
      if (cached!.revision !== expectedRevision) throw new ServerError('revision-conflict')
      const previous = cached!.library
      if (
        !(['decks', 'notes', 'media', 'savedSearches', 'sources'] as const).every(
          (key) => previous[key] === library[key],
        ) ||
        library.cards.length !== previous.cards.length ||
        library.practices.length > 100_000 ||
        library.attempts.length > 500_000 ||
        library.reviews.length > 500_000
      )
        workspaceLibrarySchema.parse(library)
      else
        validateLibraryReferences(library, () => {
          throw new ServerError('invalid-data')
        })
      const patches: Patch[] = []
      for (const store of recordStores) {
        if (cached!.library[store] === library[store]) continue
        const prior = new Map(
          cached!.library[store].map((value, position) => [value.id, { value, position }]),
        )
        for (const [position, value] of library[store].entries()) {
          const before = prior.get(value.id)
          if (
            !before ||
            before.position !== position ||
            (before.value !== value && JSON.stringify(before.value) !== JSON.stringify(value))
          )
            patches.push({
              store,
              id: value.id,
              position,
              value: recordSchemas[store].parse(value),
            })
          prior.delete(value.id)
        }
        for (const id of prior.keys()) patches.push({ store, id })
      }
      for (const asset of options.assets ?? []) {
        if (!library.media.some((meta) => meta.id === asset.meta.id)) continue
        if (asset.meta.size !== asset.blob.size || asset.meta.type !== asset.blob.type)
          throw new ServerError('invalid-data')
        await api(`/media/${encodeURIComponent(asset.meta.id)}`, {
          method: 'PUT',
          headers: { 'Content-Type': asset.blob.type },
          body: asset.blob,
        })
      }
      const result = await apiJson<{ revision: number }>('/library/commit', {
        expectedRevision,
        patches,
        reason: options.reason,
      })
      if (result.revision !== expectedRevision + 1) throw new ServerError('revision-conflict')
      cached = {
        revision: result.revision,
        library:
          compactHistory && library.attempts.some(hasAttemptBody)
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
      if (expectedRevision !== cached?.revision) throw new ServerError('revision-conflict')
      if (!compactHistory) {
        const attempt = cached?.library.attempts.find((entry) => entry.id === id)
        if (!attempt || !hasAttemptBody(attempt)) throw new ServerError('not-found')
        return attempt
      }
      const result = z
        .object({
          revision: z.number().int().nonnegative(),
          attempts: z.array(attemptSchema).length(1),
        })
        .parse(
          await apiJson(
            '/library/attempts',
            { mode: 'one', id, revision: expectedRevision },
            signal,
          ),
        )
      signal?.throwIfAborted()
      if (
        result.revision !== expectedRevision ||
        cached?.revision !== expectedRevision ||
        result.attempts[0]!.id !== id
      )
        throw new ServerError('revision-conflict')
      return result.attempts[0]!
    },
    async readAttemptBatch(offset: number, expectedRevision: number, signal?: AbortSignal) {
      signal?.throwIfAborted()
      if (expectedRevision !== cached?.revision) throw new ServerError('revision-conflict')
      if (!compactHistory)
        return cached!.library.attempts
          .slice(offset, offset + 128)
          .map((entry) => attemptSchema.parse(entry))
      const result = z
        .object({
          revision: z.number().int().nonnegative(),
          attempts: z.array(attemptSchema).max(128),
        })
        .parse(
          await apiJson(
            '/library/attempts',
            { mode: 'batch', offset, revision: expectedRevision },
            signal,
          ),
        )
      signal?.throwIfAborted()
      if (
        result.revision !== expectedRevision ||
        cached?.revision !== expectedRevision ||
        result.attempts.some(
          (entry, index) => entry.id !== cached!.library.attempts[offset + index]?.id,
        )
      )
        throw new ServerError('revision-conflict')
      return result.attempts
    },
    async completeLibrary() {
      if (!cached) await this.load()
      const { library, revision } = cached!
      const attempts: Attempt[] = []
      while (attempts.length < library.attempts.length) {
        const batch = await this.readAttemptBatch(attempts.length, revision)
        if (!batch.length) throw new ServerError('revision-conflict')
        attempts.push(...batch)
      }
      return librarySchema.parse({ ...library, attempts })
    },
    async getMedia(id: string) {
      try {
        return await (await api(`/media/${encodeURIComponent(id)}`)).blob()
      } catch (error) {
        if (error instanceof ServerError && error.code === 'not-found') return undefined
        throw error
      }
    },
    async backupNow(force = false) {
      await apiJson('/backups', { force })
    },
    listBackups() {
      return apiJson<BackupSummary[]>('/backups')
    },
    async getBackup(id: string) {
      return migrateLibrary(await apiJson(`/backups/${encodeURIComponent(id)}`))
    },
    async queryCards(
      filter: SearchFilter,
      page = 1,
      now = new Date(),
      includeStudy = true,
      signal?: AbortSignal,
    ): Promise<CardPage> {
      signal?.throwIfAborted()
      if (!cached) await this.load()
      const matches = compileSearch(cached!.library.decks, filter, now)
      const cards = cardViews(cached!.library).filter(matches)
      const eligible = includeStudy ? cards.filter((card) => available(card, now)) : []
      const offset = (Math.max(1, page) - 1) * 50
      signal?.throwIfAborted()
      return {
        cards: cards.slice(offset, offset + 50),
        total: cards.length,
        eligible: eligible.length,
        studyIds: eligible.slice(0, 500).map((card) => card.id),
      }
    },
    async close() {
      cached = undefined
    },
  }
}
