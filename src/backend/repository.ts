import { api as request, apiJson as requestJson, ServerError } from './client'
import {
  cardViews,
  librarySchema,
  migrateLibrary,
  type Library,
  type MediaUpload,
  type SearchFilter,
} from '../core/model'
import { compileSearch } from '../core/search'
import { available } from '../core/scheduler'
import { recordStores, type Snapshot, type BackupSummary, type CardPage } from '../core/storage'

type Patch = { store: string; id: string; position?: number; value?: unknown }
export function createServerRepository(source = location.origin) {
  let cached: Snapshot | undefined
  let userId = ''
  async function api(path: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers)
    headers.set('X-Repeaty-User', userId)
    return request(path, { ...init, headers })
  }
  async function apiJson<T>(path: string, body?: unknown): Promise<T> {
    const response = await api(
      path,
      body === undefined
        ? {}
        : {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          },
    )
    return response.status === 204 ? (undefined as T) : (response.json() as Promise<T>)
  }
  return {
    scope: () => `${source}:${userId}`,
    async load(): Promise<Snapshot> {
      const status = await requestJson<{ apiVersion: number }>('/status')
      if (status.apiVersion !== 3) throw new ServerError('incompatible-version')
      if (!userId) userId = (await requestJson<{ user: { id: string } }>('/auth/session')).user.id
      const saved = await apiJson<Snapshot>('/library')
      if (!Number.isSafeInteger(saved.revision) || saved.revision < 0)
        throw new ServerError('invalid-data')
      cached = { revision: saved.revision, library: migrateLibrary(saved.library) }
      return cached
    },
    async save(
      library: Library,
      expectedRevision: number,
      options: { assets?: MediaUpload[]; reason?: string } = {},
    ): Promise<Snapshot> {
      if (!cached) await this.load()
      if (cached!.revision !== expectedRevision) throw new ServerError('revision-conflict')
      librarySchema.parse(library)
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
            patches.push({ store, id: value.id, position, value })
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
      cached = { revision: result.revision, library }
      return cached
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
