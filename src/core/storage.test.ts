import 'fake-indexeddb/auto'
import { openDB } from 'idb'
import { describe, expect, it } from 'vitest'
import { exportBackup, parseBackup, rekeyBackup } from './backups'
import { librarySchema, removeNotes, saveNote, type MediaUpload } from './model'
import { prepareMedia } from './media'
import { fixture, input, legacyFixture, now } from './test-fixtures'
import { reviewCard, undoReview } from './scheduler'
import { createRepository, MAX_AUTO_BACKUPS } from './storage'

function image(): MediaUpload {
  return prepareMedia(new File(['png-data'], 'picture.png', { type: 'image/png' }))
}
function mediaFixture() {
  const asset = image()
  const library = fixture()
  library.media.push(asset.meta)
  library.notes[0]!.frontMedia = [asset.meta.id]
  return { library, asset }
}
function repository() {
  return createRepository(`repeaty-test-${crypto.randomUUID()}`)
}

describe('portable backups', () => {
  it('round-trips notes, scheduling, undo history and media bytes', async () => {
    const { library, asset } = mediaFixture()
    const reviewed = reviewCard(library, library.cards[0]!.id, 1, now)
    const text = await exportBackup(reviewed, async () => asset.blob)
    const restored = parseBackup(text)
    expect(restored.library).toEqual(reviewed)
    expect(await restored.assets[0]!.blob.text()).toBe('png-data')
    expect(undoReview(restored.library)).toEqual(library)
    const rekeyed = rekeyBackup(restored)
    expect(rekeyed.assets[0]!.meta.id).not.toBe(asset.meta.id)
    expect(rekeyed.library.notes[0]!.frontMedia).toEqual([rekeyed.assets[0]!.meta.id])
  })
  it('loads old JSON with no media and rejects an unsupported version', () => {
    expect(parseBackup(JSON.stringify(legacyFixture())).library.cards[0]!.id).toBe('old-card')
    expect(() => parseBackup(JSON.stringify({ ...legacyFixture(), version: 99 }))).toThrow(
      '备份格式不正确',
    )
    expect(() => parseBackup('{broken')).toThrow('有效的 JSON')
  })
  it('refuses incomplete or corrupted media packages instead of silently dropping attachments', async () => {
    const { library, asset } = mediaFixture()
    await expect(exportBackup(library, async () => undefined)).rejects.toThrow('缺失或损坏')
    const raw = JSON.parse(await exportBackup(library, async () => asset.blob))
    const missing = { ...raw, assets: [] }
    expect(() => parseBackup(JSON.stringify(missing))).toThrow('媒体不完整')
    raw.assets[0].data = btoa('wrong-size')
    expect(() => parseBackup(JSON.stringify(raw))).toThrow('媒体不完整')
    expect(() => parseBackup(JSON.stringify(library))).toThrow('媒体不完整')
  })
  it('rejects invalid references, schedule dates and duplicate generated cards', () => {
    const library = fixture()
    expect(() => parseBackup(JSON.stringify({ ...library, decks: [] }))).toThrow()
    expect(() =>
      parseBackup(JSON.stringify({ ...library, cards: [...library.cards, library.cards[0]] })),
    ).toThrow()
    library.cards[0]!.schedule.due = 'invalid'
    expect(librarySchema.safeParse(library).success).toBe(false)
  })
  it('accepts only bounded image/audio files', () => {
    expect(() =>
      prepareMedia(new File(['<script>'], 'page.svg', { type: 'image/svg+xml' })),
    ).toThrow('支持')
    expect(() => prepareMedia(new File([], 'empty.png', { type: 'image/png' }))).toThrow('10 MB')
    expect(prepareMedia(new File(['audio'], 'sound.mp3', { type: 'audio/mpeg' })).meta.type).toBe(
      'audio/mpeg',
    )
  })
})

describe('IndexedDB transactions and automatic snapshots', () => {
  it('upgrades a v2 database and its snapshots without losing media or allowing an older writer', async () => {
    const name = `repeaty-v2-${crypto.randomUUID()}`
    const { library, asset } = mediaFixture()
    const legacy = JSON.parse(JSON.stringify(library))
    legacy.version = 2
    delete legacy.savedSearches
    delete legacy.notes[0].format
    const old = await openDB(name, 2, {
      upgrade(db) {
        for (const store of ['workspace', 'assets', 'backups']) db.createObjectStore(store)
      },
    })
    await old.put('workspace', { revision: 5, library: legacy }, 'main')
    await old.put('assets', asset.blob, asset.meta.id)
    await old.put(
      'backups',
      {
        id: 'old-snapshot',
        revision: 4,
        library: legacy,
        createdAt: now.toISOString(),
        reason: 'old',
      },
      'old-snapshot',
    )
    old.close()
    const repo = createRepository(name)
    const loaded = await repo.load()
    expect(loaded.revision).toBe(6)
    expect(loaded.library.version).toBe(5)
    expect(loaded.library.notes[0]!.format).toBe('plain')
    expect(await (await repo.getMedia(asset.meta.id))!.text()).toBe('png-data')
    expect((await repo.getBackup('old-snapshot')).version).toBe(5)
    await expect(openDB(name, 2)).rejects.toMatchObject({ name: 'VersionError' })
    expect((await repo.load()).revision).toBe(6)
    await repo.close()
  })
  it('atomically migrates a version 1 database and checkpoints its data', async () => {
    const name = `repeaty-migrate-${crypto.randomUUID()}`
    const old = await openDB(name, 1, {
      upgrade(db) {
        db.createObjectStore('workspace')
      },
    })
    await old.put('workspace', { revision: 7, library: legacyFixture() }, 'main')
    old.close()
    const repo = createRepository(name)
    const loaded = await repo.load()
    expect(loaded.revision).toBe(8)
    expect(loaded.library.cards[0]!.id).toBe('old-card')
    expect((await repo.listBackups())[0]).toMatchObject({ reason: '升级前快照', cards: 1 })
    expect((await repo.load()).revision).toBe(8)
    await repo.close()
  })
  it('survives reopening and rejects stale writes without overwriting data', async () => {
    const name = `repeaty-conflict-${crypto.randomUUID()}`
    const first = createRepository(name),
      second = createRepository(name)
    const library = fixture()
    await first.save(library, 0)
    expect((await second.load()).library).toEqual(library)
    await expect(
      second.save(removeNotes(library, new Set([library.notes[0]!.id])), 0),
    ).rejects.toThrow('另一个标签页')
    expect((await first.load()).library).toEqual(library)
    await first.close()
    await second.close()
    const reopened = createRepository(name)
    expect((await reopened.load()).library.cards).toHaveLength(1)
    await reopened.close()
  })
  it('preserves deleted media for snapshots and can restore the full note', async () => {
    const repo = repository()
    const { library, asset } = mediaFixture()
    await repo.save(library, 0, { assets: [asset] })
    await repo.save(removeNotes(library, new Set([library.notes[0]!.id])), 1, {
      reason: '删除笔记前',
      now,
    })
    expect(await (await repo.getMedia(asset.meta.id))!.text()).toBe('png-data')
    const snapshot = (await repo.listBackups())[0]!
    const restored = await repo.getBackup(snapshot.id)
    await repo.save(restored, 2, { reason: '恢复快照前' })
    expect((await repo.load()).library.notes[0]!.frontMedia).toEqual([asset.meta.id])
    await repo.close()
  })
  it('rolls back a failed media save, including the provisional snapshot', async () => {
    const repo = repository()
    const original = fixture()
    await repo.save(original, 0)
    const { asset } = mediaFixture()
    const invalid = saveNote(
      { ...original, media: [asset.meta] },
      { ...input, frontMedia: [asset.meta.id] },
      original.notes[0]!.id,
    )
    await expect(repo.save(invalid, 1, { reason: '编辑前' })).rejects.toThrow('媒体')
    expect(await repo.listBackups()).toHaveLength(0)
    expect((await repo.load()).library).toEqual(original)
    await repo.close()
  })
  it('does not let restored external media overwrite media referenced by old snapshots', async () => {
    const repo = repository()
    const { library, asset } = mediaFixture()
    await repo.save(library, 0, { assets: [asset] })
    const imported = rekeyBackup(parseBackup(await exportBackup(library, async () => asset.blob)))
    await repo.save(imported.library, 1, { assets: imported.assets, reason: '恢复备份前' })
    expect(await repo.getMedia(asset.meta.id)).toBeDefined()
    expect(await repo.getMedia(imported.assets[0]!.meta.id)).toBeDefined()
    await repo.close()
  })
  it('rotates snapshots, keeps unchanged revisions once and collects unreferenced media', async () => {
    const repo = repository()
    const { library, asset } = mediaFixture()
    await repo.save(library, 0, { assets: [asset] })
    let next = removeNotes(library, new Set([library.notes[0]!.id]))
    for (let revision = 1; revision <= 14; revision++) {
      next = { ...next, decks: [{ ...next.decks[0]!, name: `v${revision}` }] }
      await repo.save(next, revision, {
        reason: '修改前',
        now: new Date(now.getTime() + revision * 60000),
      })
    }
    expect(await repo.listBackups()).toHaveLength(MAX_AUTO_BACKUPS)
    expect(await repo.getMedia(asset.meta.id)).toBeUndefined()
    await repo.backupNow(true, new Date(now.getTime() + 20 * 60000))
    const first = await repo.listBackups()
    await repo.backupNow(true, new Date(now.getTime() + 21 * 60000))
    expect(await repo.listBackups()).toEqual(first)
    await repo.close()
  })
  it('creates automatic snapshots at thirty-minute intervals when data changes', async () => {
    const repo = repository()
    const library = fixture()
    await repo.save(library, 0)
    await repo.backupNow(false, now)
    await repo.save({ ...library, decks: [{ ...library.decks[0]!, name: 'changed' }] }, 1, {
      now: new Date(now.getTime() + 60000),
    })
    await repo.backupNow(false, new Date(now.getTime() + 29 * 60000))
    expect(await repo.listBackups()).toHaveLength(1)
    await repo.backupNow(false, new Date(now.getTime() + 30 * 60000))
    expect(await repo.listBackups()).toHaveLength(2)
    await repo.close()
  })
})

it('writes only a graded card and new review, and reconstructs the earlier checkpoint', async () => {
  const name = `repeaty-delta-${crypto.randomUUID()}`
  const repo = createRepository(name)
  const first = await repo.save(fixture(), 0)
  const graded = reviewCard(first.library, first.library.cards[0]!.id, 3, now)
  await repo.save(graded, 1, { now })
  const db = await openDB(name, 6)
  expect(await db.get('workspace', 'main')).toBeUndefined()
  expect(await db.count('cards')).toBe(1)
  expect(await db.count('reviews')).toBe(1)
  expect((await db.getAll('history')).map((row) => row.store).sort()).toEqual(['cards', 'reviews'])
  const checkpoints = await db.getAll('checkpoints')
  expect(checkpoints).toHaveLength(1)
  expect(checkpoints[0]).not.toHaveProperty('library')
  expect(await repo.getBackup(checkpoints[0].id)).toEqual(first.library)
  db.close()
  await repo.close()
})

it('leaves legacy data intact if migration fails validation', async () => {
  const name = `repeaty-failed-migration-${crypto.randomUUID()}`
  const db = await openDB(name, 3, {
    upgrade(db) {
      db.createObjectStore('workspace')
    },
  })
  const corrupt = { revision: 8, library: { ...fixture(), decks: [] } }
  await db.put('workspace', corrupt, 'main')
  db.close()
  const repo = createRepository(name)
  await expect(repo.load()).rejects.toThrow()
  const inspect = await openDB(name, 6)
  expect(await inspect.get('workspace', 'main')).toEqual(corrupt)
  expect(await inspect.get('meta', 'main')).toBeUndefined()
  inspect.close()
  await repo.close()
})

it('queries bounded pages in stable order and retains advanced search semantics', async () => {
  const repo = repository()
  let library = fixture()
  for (let i = 0; i < 110; i++)
    library = saveNote(
      library,
      { ...input, front: `Question ${i}`, tags: i % 2 ? ['odd'] : ['even'] },
      undefined,
      false,
      now,
    )
  await repo.save(library, 0)
  const filter = { query: '', state: 'all' as const, deckId: 'deck' }
  const second = await repo.queryCards(filter, 2, now, false)
  expect(second.total).toBe(111)
  expect(second.cards.map((card) => card.id)).toEqual(
    library.cards.slice(50, 100).map((card) => card.id),
  )
  const last = await repo.queryCards(filter, 3, now, false)
  expect(last.cards).toHaveLength(11)
  const odd = await repo.queryCards({ ...filter, query: 'tag:odd type:basic' }, 1, now)
  expect(odd.total).toBe(55)
  expect(odd.cards).toHaveLength(50)
  expect(odd.eligible).toBe(55)
  expect(odd.studyIds).toHaveLength(55)
  await expect(repo.queryCards({ ...filter, query: 'is:unknown' })).rejects.toThrow('is 支持')
  const controller = new AbortController()
  const canceled = repo.queryCards(filter, 1, now, true, controller.signal)
  queueMicrotask(() => controller.abort())
  await expect(canceled).rejects.toMatchObject({ name: 'AbortError' })
  expect((await repo.queryCards(filter, 1, now, false)).total).toBe(111)
  await repo.close()
})

it.each([4, 5])(
  'upgrades an existing normalized v%s database without changing records',
  async (seedVersion) => {
    const name = `repeaty-v4-${crypto.randomUUID()}`
    const { library, asset } = mediaFixture()
    const kinds = ['decks', 'notes', 'cards', 'reviews', 'media', 'savedSearches'] as const
    const db = await openDB(name, seedVersion, {
      upgrade(db) {
        for (const name of ['workspace', 'assets', 'backups', 'meta', 'checkpoints'])
          db.createObjectStore(name)
        for (const name of kinds) {
          const store = db.createObjectStore(name)
          store.createIndex('position', 'position')
          store.createIndex('deckId', ['deckId', 'position'])
        }
        const history = db.createObjectStore('history')
        history.createIndex('revision', 'revision')
        history.createIndex('store', 'store')
      },
    })
    const tx = db.transaction([...kinds, 'meta', 'assets'], 'readwrite')
    for (const kind of kinds) {
      for (const [position, value] of library[kind].entries()) {
        await tx
          .objectStore(kind)
          .put(
            { id: value.id, value, position, deckId: kind === 'cards' ? 'deck' : undefined },
            value.id,
          )
      }
    }
    await tx.objectStore('meta').put(
      {
        revision: 7,
        counts: Object.fromEntries(kinds.map((kind) => [kind, library[kind].length])),
      },
      'main',
    )
    await tx.objectStore('assets').put(asset.blob, asset.meta.id)
    await tx.done
    db.close()
    const repo = createRepository(name)
    expect(await repo.load()).toEqual({ revision: 7, library })
    expect(await (await repo.getMedia(asset.meta.id))?.text()).toBe('png-data')
    await expect(openDB(name, seedVersion)).rejects.toMatchObject({ name: 'VersionError' })
    await repo.close()
  },
)
