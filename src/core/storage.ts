import { msg, LocalizedError } from '../i18n'
import { openDB, type DBSchema, type IDBPTransaction } from 'idb'
import {
  emptyLibrary,
  librarySchema,
  workspaceLibrarySchema,
  validateLibraryReferences,
  migrateLibrary,
  deckSchema,
  noteSchema,
  cardSchema,
  reviewSchema,
  mediaSchema,
  savedSearchSchema,
  type Library,
  type MediaUpload,
  type SearchFilter,
  type CardView,
  renderCard,
} from './model'
import { sourceSchema } from './source-data'
import { compileSearch } from './search'
import { available } from './scheduler'
import {
  practiceSchema,
  attemptSchema,
  hasAttemptBody,
  summarizeAttempt,
  type Attempt,
} from './practice-data'

export interface Snapshot {
  revision: number
  library: Library
}
export interface AutoBackup {
  id: string
  createdAt: string
  revision: number
  reason: string
  library: Library
}
export type BackupSummary = Omit<AutoBackup, 'library'> & { cards: number; notes: number }
export const recordStores = [
  'decks',
  'notes',
  'cards',
  'reviews',
  'media',
  'savedSearches',
  'practices',
  'attempts',
  'sources',
] as const
export type RecordStore = (typeof recordStores)[number]
type Entity = Library[RecordStore][number]
interface Row {
  id: string
  value: Entity
  position: number
  deckId?: string
}
interface RecordTable {
  key: string
  value: Row
  indexes: { position: number; deckId: [string, number] }
}
interface Change {
  revision: number
  store: RecordStore
  id: string
  before?: Row
}
interface Metadata {
  revision: number
  counts: Record<RecordStore, number>
}
interface Checkpoint extends BackupSummary {
  legacy?: boolean
}
interface RepeatyDB extends DBSchema {
  workspace: { key: string; value: { revision: number; library: unknown } }
  assets: { key: string; value: Blob }
  backups: { key: string; value: AutoBackup }
  meta: { key: string; value: Metadata }
  checkpoints: { key: string; value: Checkpoint }
  history: {
    key: [number, string, string]
    value: Change
    indexes: { revision: number; store: string }
  }
  decks: RecordTable
  notes: RecordTable
  cards: RecordTable
  reviews: RecordTable
  media: RecordTable
  savedSearches: RecordTable
  practices: RecordTable
  attempts: RecordTable
  attemptSummaries: RecordTable
  sources: RecordTable
}
const stores = [
  'workspace',
  'assets',
  'backups',
  'meta',
  'checkpoints',
  'history',
  'attemptSummaries',
  ...recordStores,
] as const
type Transaction = IDBPTransaction<RepeatyDB, typeof stores, 'readwrite'>
const schemas = {
  sources: sourceSchema,
  decks: deckSchema,
  notes: noteSchema,
  cards: cardSchema,
  reviews: reviewSchema,
  media: mediaSchema,
  savedSearches: savedSearchSchema,
  practices: practiceSchema,
  attempts: attemptSchema,
}
const BACKUP_INTERVAL = 30 * 60_000
export const MAX_AUTO_BACKUPS = 10
const counts = (library: Library) =>
  Object.fromEntries(recordStores.map((key) => [key, library[key].length])) as Metadata['counts']
const newest = (a: BackupSummary, b: BackupSummary) =>
  b.createdAt.localeCompare(a.createdAt) || b.revision - a.revision
export interface CardPage {
  cards: CardView[]
  total: number
  eligible: number
  studyIds: string[]
}

/** Domain updates are immutable: keep unchanged records by reference. Only changed rows are written. */
export function createRepository(
  name = 'repeaty',
  onBlocked?: () => void,
  options: { compactHistory?: boolean } = {},
) {
  const database = openDB<RepeatyDB>(name, 8, {
    async upgrade(db, _oldVersion, _newVersion, tx) {
      try {
        for (const store of stores)
          if (!db.objectStoreNames.contains(store)) db.createObjectStore(store)
        for (const store of recordStores) {
          const table = tx.objectStore(store)
          if (!table.indexNames.contains('position')) table.createIndex('position', 'position')
          if (!table.indexNames.contains('deckId'))
            table.createIndex('deckId', ['deckId', 'position'])
        }
        const history = tx.objectStore('history')
        if (!history.indexNames.contains('revision')) history.createIndex('revision', 'revision')
        if (!history.indexNames.contains('store')) history.createIndex('store', 'store')
        const summaries = tx.objectStore('attemptSummaries')
        if (!summaries.indexNames.contains('position'))
          summaries.createIndex('position', 'position')
        let cursor = await tx.objectStore('attempts').openCursor()
        while (cursor) {
          const row = cursor.value
          await summaries.put({ ...row, value: summarizeAttempt(row.value as Attempt) }, row.id)
          cursor = await cursor.continue()
        }
      } catch {
        // An async upgrade callback must abort explicitly on JavaScript errors too.
        await abort(tx)
      }
    },
    blocking() {
      void database.then((db) => db.close())
    },
    blocked() {
      onBlocked?.()
    },
  })
  let cached: Snapshot | undefined
  let maps = new Map<RecordStore, Map<string, { value: Entity; position: number }>>()
  function remember(snapshot: Snapshot, patches?: { store: RecordStore; id: string; row?: Row }[]) {
    if (options.compactHistory && snapshot.library.attempts.some(hasAttemptBody)) {
      snapshot = {
        ...snapshot,
        library: {
          ...snapshot.library,
          attempts: snapshot.library.attempts.map((entry) =>
            hasAttemptBody(entry) ? summarizeAttempt(entry) : entry,
          ),
        },
      }
    }
    cached = snapshot
    if (patches) {
      for (const patch of patches) {
        if (patch.row)
          maps.get(patch.store)!.set(patch.id, {
            value:
              options.compactHistory && patch.store === 'attempts'
                ? snapshot.library.attempts[patch.row.position]!
                : patch.row.value,
            position: patch.row.position,
          })
        else maps.get(patch.store)!.delete(patch.id)
      }
      return snapshot
    }
    maps = new Map(
      recordStores.map((store) => [
        store,
        new Map(snapshot.library[store].map((value, position) => [value.id, { value, position }])),
      ]),
    )
    return snapshot
  }
  async function abort(tx: Pick<Transaction, 'abort' | 'done'>) {
    try {
      tx.abort()
    } catch {
      /* Already aborted. */
    }
    await tx.done.catch(() => {})
  }
  async function readLibrary(tx: Transaction): Promise<Library> {
    const library = emptyLibrary()
    await Promise.all(
      recordStores.map(async (store) => {
        const source = store === 'attempts' && options.compactHistory ? 'attemptSummaries' : store
        const rows = await tx.objectStore(source).index('position').getAll()
        ;(library[store] as Entity[]) = rows.map((row) => row.value)
      }),
    )
    return library
  }
  const changed = () => new LocalizedError(msg('数据已在另一个标签页更新，请刷新页面后重试。'))
  async function prune(tx: Transaction) {
    const checkpoints = (await tx.objectStore('checkpoints').getAll()).sort(newest)
    const expired = checkpoints.slice(MAX_AUTO_BACKUPS)
    for (const entry of expired) {
      await tx.objectStore('checkpoints').delete(entry.id)
      if (entry.legacy) await tx.objectStore('backups').delete(entry.id)
    }
    const revisions = checkpoints
      .slice(0, MAX_AUTO_BACKUPS)
      .filter((entry) => !entry.legacy)
      .map((entry) => entry.revision)
    const oldest = revisions.length ? Math.min(...revisions) : Infinity
    let cursor = await tx
      .objectStore('history')
      .index('revision')
      .openCursor(IDBKeyRange.upperBound(oldest))
    while (cursor) {
      await cursor.delete()
      cursor = await cursor.continue()
    }
    return expired.length > 0
  }
  async function checkpoint(
    tx: Transaction,
    meta: Metadata,
    reason: string,
    now: Date,
    force: boolean,
  ) {
    if (!meta.counts.notes && !meta.counts.sources && !force) return false
    const entries = await tx.objectStore('checkpoints').getAll()
    const latest = entries.sort(newest)[0]
    if (
      entries.some((entry) => entry.revision === meta.revision && !entry.legacy) ||
      (!force && latest && now.getTime() - new Date(latest.createdAt).getTime() < BACKUP_INTERVAL)
    )
      return false
    const entry: Checkpoint = {
      id: crypto.randomUUID(),
      createdAt: now.toISOString(),
      revision: meta.revision,
      reason,
      cards: meta.counts.cards,
      notes: meta.counts.notes,
    }
    await tx.objectStore('checkpoints').put(entry, entry.id)
    return prune(tx)
  }
  async function collectUnusedAssets(tx: Transaction) {
    const used = new Set(await tx.objectStore('media').getAllKeys())
    // Only media changes and legacy snapshots can retain deleted blobs, not the entire study history.
    for (const change of await tx.objectStore('history').index('store').getAll('media'))
      if (change.before) used.add(change.id)
    for (const entry of await tx.objectStore('backups').getAll())
      for (const media of migrateLibrary(entry.library).media) used.add(media.id)
    for (const id of await tx.objectStore('assets').getAllKeys())
      if (!used.has(id)) await tx.objectStore('assets').delete(id)
  }
  async function migrate(tx: Transaction): Promise<Metadata> {
    const meta = await tx.objectStore('meta').get('main')
    if (meta) {
      meta.counts.sources ??= 0
      meta.counts.practices ??= 0
      meta.counts.attempts ??= 0
      return meta
    }
    const old = await tx.objectStore('workspace').get('main')
    const library = old ? migrateLibrary(old.library) : emptyLibrary()
    const next = { revision: old ? old.revision + 1 : 0, counts: counts(library) }
    const noteDecks = new Map(library.notes.map((note) => [note.id, note.deckId]))
    for (const store of recordStores) {
      await Promise.all(
        library[store].map((value, position) =>
          tx.objectStore(store).put(
            {
              id: value.id,
              value,
              position,
              deckId:
                store === 'cards'
                  ? noteDecks.get((value as Library['cards'][number]).noteId)
                  : undefined,
            },
            value.id,
          ),
        ),
      )
      if (store === 'attempts')
        await Promise.all(
          library.attempts.map((value, position) =>
            tx
              .objectStore('attemptSummaries')
              .put({ id: value.id, value: summarizeAttempt(value), position }, value.id),
          ),
        )
    }
    for (const entry of await tx.objectStore('backups').getAll()) {
      const normalized = migrateLibrary(entry.library)
      await tx.objectStore('checkpoints').put(
        {
          id: entry.id,
          createdAt: entry.createdAt,
          revision: entry.revision,
          reason: entry.reason,
          cards: normalized.cards.length,
          notes: normalized.notes.length,
          legacy: true,
        },
        entry.id,
      )
    }
    await tx.objectStore('meta').put(next, 'main')
    if (old) {
      await checkpoint(tx, next, '升级前快照', new Date(), true)
      await tx.objectStore('workspace').delete('main')
    }
    return next
  }
  return {
    scope: () => `local:${name}`,
    async load(): Promise<Snapshot> {
      const db = await database
      const tx = db.transaction(stores, 'readwrite')
      try {
        const meta = await migrate(tx)
        const library = await readLibrary(tx)
        await checkpoint(tx, meta, '自动备份', new Date(), false)
        await tx.done
        return remember({ revision: meta.revision, library })
      } catch (error) {
        await abort(tx)
        throw error
      }
    },
    async save(
      library: Library,
      expectedRevision: number,
      options: { assets?: MediaUpload[]; reason?: string; now?: Date } = {},
    ): Promise<Snapshot> {
      if (!cached) await this.load()
      const previous = cached!.library
      // The frequent grading path validates only changed cards/reviews. Structural edits and
      // external restores still receive complete cross-reference validation at the boundary.
      const progressOnly =
        ['decks', 'notes', 'media', 'savedSearches', 'sources'].every(
          (key) => previous[key as RecordStore] === library[key as RecordStore],
        ) &&
        library.cards.length === previous.cards.length &&
        library.cards.every((card) => {
          const prior = maps.get('cards')!.get(card.id)?.value as
            Library['cards'][number] | undefined
          return prior && prior.noteId === card.noteId && prior.variant === card.variant
        })
      if (!progressOnly || library.practices.length > 100_000 || library.attempts.length > 500_000)
        workspaceLibrarySchema.parse(library)
      if (library.reviews.length > 500_000)
        throw new LocalizedError(msg('复习记录已达到 50 万条上限，请先导出备份。'))
      const patches: { store: RecordStore; id: string; row?: Row }[] = []
      const next = { ...library }
      const noteDecks = new Map(library.notes.map((note) => [note.id, note.deckId]))
      for (const store of recordStores) {
        if (
          previous[store] === library[store] &&
          !(store === 'cards' && previous.notes !== library.notes)
        )
          continue
        const before = maps.get(store)!
        const seen = new Set<string>()
        const values: Entity[] = []
        for (let position = 0; position < library[store].length; position++) {
          const value = library[store][position]!
          if (seen.has(value.id)) throw new Error(`${store}: duplicate ID`)
          seen.add(value.id)
          const prior = before.get(value.id)
          const same =
            prior &&
            (prior.value === value || JSON.stringify(prior.value) === JSON.stringify(value))
          const normalized = same ? prior.value : schemas[store].parse(value)
          if (
            store === 'reviews' &&
            !same &&
            !maps.get('cards')!.has((normalized as Library['reviews'][number]).cardId) &&
            progressOnly
          )
            throw new Error('Review references a missing card')
          if (store === 'reviews' && progressOnly && !same) {
            const review = normalized as Library['reviews'][number]
            if (
              review.practiceId &&
              !library.practices.some(
                (entry) => entry.id === review.practiceId && entry.cardId === review.cardId,
              )
            )
              throw new Error('Review references a missing practice')
          }
          values.push(normalized)
          const deckId =
            store === 'cards'
              ? noteDecks.get((value as Library['cards'][number]).noteId)
              : undefined
          const oldNote =
            store === 'cards'
              ? (maps.get('notes')!.get((value as Library['cards'][number]).noteId)?.value as
                  Library['notes'][number] | undefined)
              : undefined
          if (
            !same ||
            prior.position !== position ||
            (store === 'cards' && oldNote?.deckId !== deckId)
          )
            patches.push({
              store,
              id: value.id,
              row: { id: value.id, value: normalized, position, deckId },
            })
        }
        for (const id of before.keys()) if (!seen.has(id)) patches.push({ store, id })
        ;(next[store] as Entity[]) = values
      }
      const hasHistory =
        previous.practices.length > 0 ||
        next.practices.length > 0 ||
        previous.attempts.length > 0 ||
        next.attempts.length > 0
      if (
        !progressOnly ||
        (hasHistory &&
          (previous.practices !== next.practices ||
            previous.attempts !== next.attempts ||
            previous.reviews !== next.reviews))
      )
        validateLibraryReferences(next, (message) => {
          throw new Error(message)
        })
      const db = await database
      const tx = db.transaction(stores, 'readwrite')
      try {
        const current = await migrate(tx)
        if (current.revision !== expectedRevision || cached!.revision !== expectedRevision)
          throw changed()
        const expired =
          current.revision > 0 &&
          (await checkpoint(
            tx,
            current,
            options.reason ?? '自动备份',
            options.now ?? new Date(),
            Boolean(options.reason),
          ))
        const revision = expectedRevision + 1
        const retain = (await tx.objectStore('checkpoints').getAll()).some((entry) => !entry.legacy)
        for (const asset of options.assets ?? []) {
          const meta = next.media.find((entry) => entry.id === asset.meta.id)
          if (!meta) continue
          if (meta.type !== asset.blob.type || meta.size !== asset.blob.size)
            throw new LocalizedError(msg('媒体内容与文件信息不一致。'))
          if (await tx.objectStore('assets').getKey(meta.id))
            throw new LocalizedError(msg('媒体 ID 冲突，未覆盖已有文件。'))
          await tx.objectStore('assets').put(asset.blob, meta.id)
        }
        for (let start = 0; start < patches.length; start += 256) {
          await Promise.all(
            patches.slice(start, start + 256).map(async (patch) => {
              const table = tx.objectStore(patch.store)
              if (retain)
                await tx.objectStore('history').put(
                  {
                    revision,
                    store: patch.store,
                    id: patch.id,
                    before: await table.get(patch.id),
                  },
                  [revision, patch.store, patch.id],
                )
              if (
                patch.store === 'media' &&
                patch.row &&
                !(await tx.objectStore('assets').getKey(patch.id))
              )
                throw new LocalizedError(
                  msg('媒体「{p0}」缺失，未保存修改。', {
                    p0: (patch.row.value as Library['media'][number]).name,
                  }),
                )
              if (patch.row) await table.put(patch.row, patch.id)
              else await table.delete(patch.id)
              if (patch.store === 'attempts') {
                if (patch.row)
                  await tx
                    .objectStore('attemptSummaries')
                    .put(
                      { ...patch.row, value: summarizeAttempt(patch.row.value as Attempt) },
                      patch.id,
                    )
                else await tx.objectStore('attemptSummaries').delete(patch.id)
              }
            }),
          )
        }
        await tx.objectStore('meta').put({ revision, counts: counts(next) }, 'main')
        if (expired || patches.some((patch) => patch.store === 'media'))
          await collectUnusedAssets(tx)
        await tx.done
        return remember({ revision, library: next }, patches)
      } catch (error) {
        await abort(tx)
        throw error
      }
    },
    async getAttempt(id: string, expectedRevision = cached?.revision, signal?: AbortSignal) {
      signal?.throwIfAborted()
      const tx = (await database).transaction(['meta', 'attempts'], 'readonly')
      const [meta, row] = await Promise.all([
        tx.objectStore('meta').get('main'),
        tx.objectStore('attempts').get(id),
      ])
      await tx.done
      signal?.throwIfAborted()
      if (meta?.revision !== expectedRevision) throw changed()
      if (!row) throw new LocalizedError(msg('提交记录已不存在，请刷新后重试。'))
      return attemptSchema.parse(row.value)
    },
    async readAttemptBatch(offset: number, expectedRevision: number, signal?: AbortSignal) {
      signal?.throwIfAborted()
      const tx = (await database).transaction(['meta', 'attempts'], 'readonly')
      const [meta, rows] = await Promise.all([
        tx.objectStore('meta').get('main'),
        tx.objectStore('attempts').index('position').getAll(IDBKeyRange.lowerBound(offset), 128),
      ])
      await tx.done
      signal?.throwIfAborted()
      if (meta?.revision !== expectedRevision) throw changed()
      return rows.map((row, index) => {
        if (row.position !== offset + index) throw changed()
        return attemptSchema.parse(row.value)
      })
    },
    async completeLibrary() {
      if (!cached) await this.load()
      const { library, revision } = cached!
      const attempts: Attempt[] = []
      while (attempts.length < library.attempts.length) {
        const batch = await this.readAttemptBatch(attempts.length, revision)
        if (!batch.length) throw changed()
        attempts.push(...batch)
      }
      return librarySchema.parse({ ...library, attempts })
    },
    async backupNow(force = false, now = new Date()) {
      const db = await database,
        tx = db.transaction(stores, 'readwrite')
      try {
        const meta = await migrate(tx)
        if (await checkpoint(tx, meta, force ? '手动快照' : '自动备份', now, force))
          await collectUnusedAssets(tx)
        await tx.done
      } catch (error) {
        await abort(tx)
        throw error
      }
    },
    async listBackups(): Promise<BackupSummary[]> {
      return (await (await database).getAll('checkpoints'))
        .sort(newest)
        .map(({ legacy: _legacy, ...entry }) => entry)
    },
    async getBackup(id: string): Promise<Library> {
      const db = await database
      const tx = db.transaction(stores, 'readwrite')
      try {
        const checkpoint = await tx.objectStore('checkpoints').get(id)
        if (!checkpoint) throw new LocalizedError(msg('该快照已被清理，请重新打开备份列表。'))
        if (checkpoint.legacy) {
          const entry = await tx.objectStore('backups').get(id)
          await tx.done
          return migrateLibrary(entry!.library)
        }
        const tables = new Map<RecordStore, Map<string, Row>>()
        for (const store of recordStores)
          tables.set(
            store,
            new Map((await tx.objectStore(store).getAll()).map((row) => [row.id, row])),
          )
        let cursor = await tx
          .objectStore('history')
          .index('revision')
          .openCursor(IDBKeyRange.lowerBound(checkpoint.revision, true), 'prev')
        while (cursor) {
          const change = cursor.value,
            table = tables.get(change.store)!
          if (change.before) table.set(change.id, change.before)
          else table.delete(change.id)
          cursor = await cursor.continue()
        }
        const library = emptyLibrary()
        for (const store of recordStores)
          (library[store] as Entity[]) = [...tables.get(store)!.values()]
            .sort((a, b) => a.position - b.position)
            .map((row) => row.value)
        await tx.done
        return librarySchema.parse(library)
      } catch (error) {
        await abort(tx)
        throw error
      }
    },
    async queryCards(
      filter: SearchFilter,
      page = 1,
      now = new Date(),
      includeStudy = true,
      signal?: AbortSignal,
    ): Promise<CardPage> {
      signal?.throwIfAborted()
      const db = await database
      const tx = db.transaction(['decks', 'notes', 'cards'], 'readonly')
      const decks = (await tx.objectStore('decks').getAll()).map(
        (row) => row.value,
      ) as Library['decks']
      const matches = compileSearch(decks, filter, now)
      const result: CardPage = { cards: [], total: 0, eligible: 0, studyIds: [] }
      const notes = new Map<string, Library['notes'][number]>()
      const source = filter.deckId
        ? tx.objectStore('cards').index('deckId')
        : tx.objectStore('cards').index('position')
      let cursor = await source.openCursor(
        filter.deckId
          ? IDBKeyRange.bound([filter.deckId, 0], [filter.deckId, Infinity])
          : undefined,
      )
      const offset = (Math.max(1, page) - 1) * 50
      const simple = !filter.query.trim() && filter.state === 'all' && !includeStudy
      if (simple) {
        result.total = await source.count(
          filter.deckId
            ? IDBKeyRange.bound([filter.deckId, 0], [filter.deckId, Infinity])
            : undefined,
        )
        if (cursor && offset) cursor = await cursor.advance(offset)
      }
      while (cursor && !signal?.aborted) {
        const card = cursor.value.value as Library['cards'][number]
        let note = notes.get(card.noteId)
        if (!note) {
          note = (await tx.objectStore('notes').get(card.noteId))!.value as Library['notes'][number]
          notes.set(note.id, note)
        }
        const view = renderCard(card, note)
        if (matches(view)) {
          if ((simple || result.total >= offset) && result.cards.length < 50)
            result.cards.push(view)
          if (!simple) result.total++
          if (includeStudy && available(card, now)) {
            result.eligible++
            if (result.studyIds.length < 500) result.studyIds.push(card.id)
          }
        }
        if (simple && result.cards.length === 50) break
        cursor = await cursor.continue()
      }
      await tx.done
      signal?.throwIfAborted()
      return result
    },
    async getMedia(id: string) {
      return (await database).get('assets', id)
    },
    async close() {
      ;(await database).close()
    },
  }
}
