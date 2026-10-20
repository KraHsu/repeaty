import 'fake-indexeddb/auto'
import { expect, it } from 'vitest'
import { openDB } from 'idb'
import { prepareSource, readSource, sourceExcerpt, addSource, removeSource } from './sources'
import { emptyLibrary, librarySchema, migrateLibrary, saveNote, removeNotes } from './model'
import { fixture, now, input } from './test-fixtures'
import { createRepository, recordStores } from './storage'
import { exportArchive, parseArchive } from './archive'
import { exportBackup, parseBackup, rekeyBackup } from './backups'
import { reviewCard } from './scheduler'

const content = '# 原文\n\n同一句。🙂 同一句。\n\n' + 'Long text 中文\n'.repeat(3000)
function sample() {
  const prepared = prepareSource(
    { title: '学习材料', url: 'https://example.org/notes', format: 'markdown', content },
    now,
  )
  const library = addSource(fixture(), prepared.source, prepared.asset)
  return { ...prepared, library }
}
it('stores a single lazy snapshot, anchors repeated Unicode text by exact offsets, and preserves progress on edits', async () => {
  const { source, asset, library } = sample()
  expect(source).not.toHaveProperty('content')
  expect(await readSource(source, library, async () => asset.blob)).toBe(content)
  const start = content.lastIndexOf('同一句。'),
    excerpt = sourceExcerpt(source, content, start, start + 4)
  const note = library.notes[0]!
  let next = saveNote(library, { ...note, excerpt }, note.id)
  next = reviewCard(next, next.cards[0]!.id, 3, now)
  const cards = next.cards,
    reviews = next.reviews
  next = saveNote(next, { ...input, front: 'Edited question' }, note.id)
  expect(next.notes[0]!.excerpt).toEqual(excerpt)
  expect(next.cards).toEqual(cards)
  expect(next.reviews).toEqual(reviews)
  expect(removeNotes(next, new Set([note.id])).media).toEqual([asset.meta])
  librarySchema.parse(next)
})
it('normalizes Windows newlines and BOM before recording offsets', async () => {
  const { source, asset } = prepareSource(
    { title: 'Windows text', url: '', format: 'plain', content: '\uFEFFOne\r\nTwo🙂\rThree' },
    now,
  )
  const library = addSource(fixture(), source, asset)
  const text = await readSource(source, library, async () => asset.blob)
  expect(text).toBe('One\nTwo🙂\nThree')
  const start = text.indexOf('Two')
  expect(sourceExcerpt(source, text, start, start + 'Two🙂'.length).quote).toBe('Two🙂')
})
it('bounds input, refuses invalid links or split emoji, and never treats text snapshots as card audio', () => {
  const { source, asset, library } = sample()
  expect(() =>
    prepareSource({ title: 'T', url: 'javascript:bad()', format: 'plain', content: 'x' }),
  ).toThrow()
  expect(() =>
    prepareSource({ title: 'T', url: '', format: 'plain', content: 'x'.repeat(250_001) }),
  ).toThrow('250000')
  expect(() => sourceExcerpt(source, content, 0, 10001)).toThrow('10000')
  const emoji = content.indexOf('🙂')
  expect(() => sourceExcerpt(source, content, emoji, emoji + 1)).toThrow('完整')
  expect(() => sourceExcerpt(source, content, emoji + 1, emoji + 2)).toThrow('完整')
  expect(() => saveNote(library, { ...input, frontMedia: [asset.meta.id] })).not.toThrow()
  expect(() =>
    librarySchema.parse(saveNote(library, { ...input, frontMedia: [asset.meta.id] })),
  ).toThrow('正文快照')
})
it('reports missing or invalid UTF-8 snapshots and cancels a pending read', async () => {
  const { source, asset, library } = sample()
  await expect(readSource(source, library, async () => undefined)).rejects.toThrow('原文快照')
  const invalid = new Blob([new Uint8Array([255, 255])], { type: asset.meta.type })
  await expect(
    readSource(
      { ...source, characters: 2 },
      { ...library, media: [{ ...asset.meta, size: 2 }] },
      async () => invalid,
    ),
  ).rejects.toThrow('原文快照')
  const controller = new AbortController()
  await expect(
    readSource(
      source,
      library,
      async () => {
        controller.abort()
        return asset.blob
      },
      controller.signal,
    ),
  ).rejects.toMatchObject({ name: 'AbortError' })
})
it('deletes a source independently, detaches excerpts and restores the snapshot without changing card history', async () => {
  const { source, asset, library } = sample()
  const excerpt = sourceExcerpt(source, content, 0, 4)
  let next = saveNote(library, { ...library.notes[0]!, excerpt }, library.notes[0]!.id)
  next = reviewCard(next, next.cards[0]!.id, 3, now)
  const repo = createRepository(`sources-${crypto.randomUUID()}`)
  await repo.load()
  await repo.save(next, 0, { assets: [asset] })
  const removed = removeSource(next, source.id)
  expect(removed.notes[0]!.excerpt).toBeUndefined()
  expect(removed.cards).toBe(next.cards)
  expect(removed.reviews).toBe(next.reviews)
  expect(removed.media).toEqual([])
  await repo.save(removed, 1, { reason: '删除材料前' })
  const before = await repo.getBackup((await repo.listBackups())[0]!.id)
  expect(before).toEqual(next)
  expect(await readSource(before.sources[0]!, before, (id) => repo.getMedia(id))).toBe(content)
  await repo.save(before, 2)
  expect((await repo.load()).library.notes[0]!.excerpt).toEqual(excerpt)
  await repo.close()
})
it('round-trips sources and offsets through archives, JSON and media rekeying', async () => {
  const { source, asset, library } = sample()
  const linked = saveNote(
    library,
    { ...library.notes[0]!, excerpt: sourceExcerpt(source, content, 2, 4) },
    library.notes[0]!.id,
  )
  const archive = await parseArchive((await exportArchive(linked, async () => asset.blob))!)
  const json = parseBackup(await exportBackup(linked, async () => asset.blob))
  for (const data of [archive, json]) {
    const restored = rekeyBackup(data)
    expect(restored.library.sources[0]!.mediaId).not.toBe(asset.meta.id)
    expect(restored.library.notes[0]!.excerpt).toEqual(linked.notes[0]!.excerpt)
    expect(
      await readSource(
        restored.library.sources[0]!,
        restored.library,
        async (id) => restored.assets.find((entry) => entry.meta.id === id)?.blob,
      ),
    ).toBe(content)
  }
})
it('upgrades a real v7 database and keeps existing checkpoints, while old clients cannot write', async () => {
  const name = `sources-v7-${crypto.randomUUID()}`,
    library = fixture()
  const oldStores = recordStores.filter((key) => key !== 'sources')
  const db = await openDB(name, 7, {
    upgrade(db) {
      for (const key of [
        'workspace',
        'assets',
        'backups',
        'meta',
        'checkpoints',
        'history',
        'attemptSummaries',
        ...oldStores,
      ])
        db.createObjectStore(key)
    },
  })
  const tx = db.transaction([...oldStores, 'meta', 'checkpoints'], 'readwrite')
  for (const key of oldStores)
    for (const [position, value] of library[key].entries())
      await tx.objectStore(key).put({ id: value.id, value, position }, value.id)
  await tx.objectStore('meta').put(
    {
      revision: 7,
      counts: Object.fromEntries(oldStores.map((key) => [key, library[key].length])),
    },
    'main',
  )
  await tx.objectStore('checkpoints').put(
    {
      id: 'v7-snapshot',
      revision: 7,
      createdAt: now.toISOString(),
      reason: '手动快照',
      cards: library.cards.length,
      notes: library.notes.length,
    },
    'v7-snapshot',
  )
  await tx.done
  db.close()
  const repo = createRepository(name)
  expect((await repo.load()).library).toEqual(library)
  expect(await repo.getBackup('v7-snapshot')).toEqual(library)
  await expect(openDB(name, 7)).rejects.toMatchObject({ name: 'VersionError' })
  const { sources: _sources, ...v5 } = library
  expect(migrateLibrary({ ...v5, version: 5 })).toEqual(library)
  expect(() => librarySchema.parse(v5)).toThrow()
  expect(emptyLibrary().version).toBe(8)
  await repo.close()
})
