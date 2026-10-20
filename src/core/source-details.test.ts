import 'fake-indexeddb/auto'
import { expect, it, vi } from 'vitest'
import { fixture, input, now } from './test-fixtures'
import {
  addSource,
  editSourceDetails,
  prepareSource,
  prepareSourceExcerpt,
  sourceExcerpt,
  saveReadingPosition,
} from './sources'
import { saveNote, type Library } from './model'
import { reviewCard } from './scheduler'
import { exportArchive, parseArchive } from './archive'
import { exportBackup, parseBackup, rekeyBackup } from './backups'
import { createRepository, recordStores } from './storage'
import type { Source, SourceDetails } from './source-data'

function sample() {
  const text = '重复🙂\n重复🙂\n' + 'Long text 中文\n'.repeat(200)
  const root = prepareSource(
    { title: 'Original', url: 'https://example.org/old', format: 'plain', content: text },
    now,
  )
  const start = text.lastIndexOf('重复')
  const child = prepareSourceExcerpt(
    root.source,
    text,
    sourceExcerpt(root.source, text, start, start + 4),
    'Excerpt',
    now,
  )
  root.source.priority = 'high'
  root.source.readingIntervalDays = 7
  root.source.queue = { state: 'active', availableOn: '2099-12-31' }
  child.source.priority = 'low'
  child.source.queue = { state: 'archived', availableOn: '2026-10-17' }
  let library = addSource(addSource(fixture(), root.source, root.asset), child.source, child.asset)
  library.notes[0]!.excerpt = sourceExcerpt(root.source, text, start, start + 4)
  library = saveNote(
    library,
    { ...input, type: 'reversed', excerpt: sourceExcerpt(child.source, '重复🙂', 0, 4) },
    undefined,
    false,
    now,
  )
  library = reviewCard(library, library.cards[0]!.id, 3, now)
  library = saveReadingPosition(
    library,
    root.source.id,
    root.source.mediaId,
    { offset: 100, fraction: 0, view: 'source' },
    now,
  )
  const before = (source: Source) => ({ title: source.title, url: source.url })
  const change = (current: Library, source: Source, details: SourceDetails) =>
    editSourceDetails(current, source.id, source.mediaId, before(source), details)
  return { library, root, child, before, change, assets: [root.asset, child.asset] }
}

it('edits only the chosen source details and preserves all bodies, reading arrangements, anchors and learning', () => {
  const { library, root, child, change } = sample()
  const next = change(library, root.source, {
    title: '  原文 renamed🙂  ',
    url: ' https://example.org/new?q=1#part ',
  })
  expect(next.sources[0]).toEqual({
    ...library.sources[0],
    title: '原文 renamed🙂',
    url: 'https://example.org/new?q=1#part',
  })
  expect(next.sources[1]).toBe(library.sources[1])
  expect(next.sources[1]!.url).toBe('https://example.org/old')
  const editedChild = change(next, child.source, { title: 'Renamed excerpt', url: '' })
  expect(editedChild.sources[1]).toEqual({ ...child.source, title: 'Renamed excerpt', url: '' })
  for (const current of [next, editedChild]) {
    for (const store of recordStores.filter((store) => store !== 'sources'))
      expect(current[store]).toBe(library[store])
  }
  expect(library.sources[0]!.title).toBe('Original')
})

it('rejects invalid fields, readonly changes, stale metadata, missing sources and replacement snapshots', () => {
  const { library, root, before, change } = sample()
  const unchanged = structuredClone(library)
  for (const details of [
    { title: '  ', url: '' },
    { title: 'x'.repeat(161), url: '' },
    { title: 'Valid', url: 'javascript:alert(1)' },
    { title: 'Valid', url: 'https://bad link' },
    { title: 'Valid', url: 'https://example.org/' + 'x'.repeat(2048) },
    { title: 'Valid', url: '', mediaId: 'replacement', kind: 'excerpt', readingIntervalDays: 30 },
  ])
    expect(() => change(library, root.source, details)).toThrow()
  for (const [id, mediaId, previous] of [
    ['missing', root.source.mediaId, before(root.source)],
    [root.source.id, 'replacement', before(root.source)],
    [root.source.id, root.source.mediaId, { ...before(root.source), title: 'Older title' }],
    [
      root.source.id,
      root.source.mediaId,
      { ...before(root.source), url: 'https://example.org/stale' },
    ],
  ] as const)
    expect(() =>
      editSourceDetails(library, id, mediaId, previous, { title: 'New', url: '' }),
    ).toThrow('材料信息已变化')
  expect(library).toEqual(unchanged)
})

it('leaves unchanged details alone and accepts a valid form after independent reading updates', () => {
  const { library, root, change } = sample()
  expect(
    change(library, root.source, { title: ' Original ', url: ' https://example.org/old ' }),
  ).toBe(library)
  const current: Library = {
    ...library,
    sources: library.sources.map((s) =>
      s.id === root.source.id ? { ...s, priority: 'low', readingIntervalDays: 14 } : s,
    ),
  }
  const edited = change(current, root.source, { title: 'New title', url: '' })
  expect(edited.sources[0]).toEqual({ ...current.sources[0], title: 'New title', url: '' })
  expect(() => change(edited, root.source, { title: 'Another edit', url: '' })).toThrow(
    '材料信息已变化',
  )
})

it('saves metadata without rereading IndexedDB bodies and retains old details in snapshots and complete backups', async () => {
  const { library, root, change, assets } = sample()
  const repo = createRepository(`source-details-${crypto.randomUUID()}`)
  try {
    await repo.load()
    await repo.save(library, 0, { assets })
    const next = change(library, root.source, { title: 'Renamed', url: '' })
    const reads = vi.spyOn(Blob.prototype, 'arrayBuffer')
    try {
      await repo.save(next, 1, { reason: '编辑材料信息前' })
      expect(reads).not.toHaveBeenCalled()
    } finally {
      reads.mockRestore()
    }
    expect((await repo.load()).library).toEqual(next)
    for (const backup of [
      await parseArchive(
        (await exportArchive(next, async (id) => assets.find((a) => a.meta.id === id)?.blob))!,
      ),
      parseBackup(
        await exportBackup(next, async (id) => assets.find((a) => a.meta.id === id)?.blob),
      ),
    ]) {
      expect(backup.library).toEqual(next)
      const restored = rekeyBackup(backup)
      expect(restored.library.sources[0]).toMatchObject({
        title: 'Renamed',
        url: '',
        readingIntervalDays: 7,
      })
      expect(restored.library.sources[1]!.origin).toEqual(next.sources[1]!.origin)
    }
    const snapshot = (await repo.listBackups()).find((b) => b.reason === '编辑材料信息前')!
    const previous = await repo.getBackup(snapshot.id)
    expect(previous).toEqual(library)
    await repo.save(previous, 2)
    expect((await repo.load()).library).toEqual(library)
  } finally {
    await repo.close()
  }
})
