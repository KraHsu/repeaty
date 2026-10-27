import 'fake-indexeddb/auto'
import { expect, it, vi } from 'vitest'
import {
  addSource,
  prepareSource,
  prepareSourceExcerpt,
  readSource,
  removeSource,
  saveReadingPosition,
  sourceExcerpt,
} from './sources'
import { emptyLibrary, librarySchema, saveNote, type MediaUpload } from './model'
import { fixture, input, now } from './test-fixtures'
import { arrangeSource, queuedSources } from './source-queue'
import { startReadingRound, advanceReadingRound } from './reading-round'
import { createRepository } from './storage'
import { exportArchive, parseArchive } from './archive'
import { exportBackup, parseBackup, rekeyBackup } from './backups'
import { reviewCard } from './scheduler'

function sample() {
  const text = '# Reading\n\nSame🙂\n\nSame🙂\n\n \uFEFF独立摘录🙂 \nend'
  const root = prepareSource(
    { title: 'Original', url: 'https://example.org/reading', format: 'markdown', content: text },
    now,
  )
  const start = text.lastIndexOf('Same')
  const selection = sourceExcerpt(root.source, text, start, start + 'Same🙂'.length)
  const child = prepareSourceExcerpt(root.source, text, selection, 'Excerpt', now)
  const library = addSource(
    addSource(emptyLibrary(), root.source, root.asset),
    child.source,
    child.asset,
  )
  const assets = [root.asset, child.asset]
  const read = async (id: string) => assets.find((asset) => asset.meta.id === id)?.blob
  return { text, root, child, selection, library, assets, read }
}

it('saves an independent lazy snapshot without a deck, preserving exact Unicode offsets and whitespace', async () => {
  const { root, child, text, library, selection, read } = sample()
  expect(library.cards).toEqual([])
  expect(child.source).toMatchObject({
    kind: 'excerpt',
    origin: {
      sourceId: root.source.id,
      mediaId: root.source.mediaId,
      start: selection.start,
      end: selection.end,
    },
    url: root.source.url,
    format: 'markdown',
  })
  expect(child.source).not.toHaveProperty('content')
  expect(child.source).not.toHaveProperty('quote')
  expect(child.source).not.toHaveProperty('priority')
  expect(child.source).not.toHaveProperty('queue')
  expect(child.asset.meta.id).not.toBe(root.asset.meta.id)
  expect(await readSource(child.source, library, read)).toBe('Same🙂')
  const start = text.indexOf('\uFEFF')
  const selection2 = sourceExcerpt(root.source, text, start, text.indexOf('end'))
  const exact = prepareSourceExcerpt(root.source, text, selection2, 'Whitespace', now)
  const next = addSource(library, exact.source, exact.asset)
  expect(await readSource(exact.source, next, async () => exact.asset.blob)).toBe(selection2.quote)
  librarySchema.parse(next)
  const nested = prepareSourceExcerpt(
    child.source,
    'Same🙂',
    sourceExcerpt(child.source, 'Same🙂', 1, 6),
    'Nested',
  )
  const nestedLibrary = addSource(library, nested.source, nested.asset)
  librarySchema.parse(nestedLibrary)
  expect(nested.source.origin).toEqual({
    sourceId: child.source.id,
    mediaId: child.source.mediaId,
    start: 1,
    end: 6,
  })
  expect(nested.source.mediaId).not.toBe(child.source.mediaId)
  expect(() =>
    prepareSourceExcerpt(root.source, text, { ...selection, quote: 'Fake🙂' }, 'Forged'),
  ).toThrow('不一致')
})

it('rejects invalid provenance, including self references, mismatched formats and lengths', () => {
  const { library, root, child } = sample()
  const origin = child.source.origin!
  const invalid = [
    { ...child.source, kind: undefined },
    { ...child.source, origin: { ...origin, sourceId: 'missing' } },
    { ...child.source, origin: { ...origin, sourceId: child.source.id } },
    { ...child.source, origin: { ...origin, end: root.source.characters + 1 } },
    { ...child.source, origin: { ...origin, end: origin.start } },
    { ...child.source, origin: { ...origin, end: origin.end - 1 } },
    { ...child.source, format: 'plain' },
    { ...child.source, characters: 10001, origin: undefined },
  ]
  for (const source of invalid)
    expect(() => librarySchema.parse({ ...library, sources: [root.source, source] })).toThrow()
  librarySchema.parse({ ...library, sources: [{ ...root.source, kind: 'excerpt' }, child.source] })
})

it('arranges excerpts independently and adds them only to the next reading round', () => {
  const { library, root, child } = sample()
  const oldRound = startReadingRound([root.source], '2026-10-17')
  const next = arrangeSource(
    library,
    child.source.id,
    child.source.mediaId,
    { type: 'priority', priority: 'high' },
    now,
  )
  expect(next.sources[0]).toBe(root.source)
  expect(queuedSources(next.sources, 'ready', '2026-10-17').map((source) => source.id)).toEqual([
    child.source.id,
    root.source.id,
  ])
  expect(advanceReadingRound(oldRound, next.sources, '2026-10-17').cursor).toBe(1)
  expect(oldRound.entries).toHaveLength(1)
  const deferred = arrangeSource(
    next,
    child.source.id,
    child.source.mediaId,
    { type: 'defer', date: '2026-10-18' },
    now,
  )
  expect(queuedSources(deferred.sources, 'ready', '2026-10-17')).toEqual([root.source])
  const archived = arrangeSource(
    deferred,
    child.source.id,
    child.source.mediaId,
    { type: 'archive' },
    now,
  )
  expect(queuedSources(archived.sources, 'archived', '2026-10-17')[0]!.priority).toBe('high')
  expect(archived.cards).toBe(library.cards)
})

it('rejects forged bodies atomically, while position updates do not reread snapshot bodies', async () => {
  const { library, root, child, assets } = sample()
  const repo = createRepository(`excerpt-integrity-${crypto.randomUUID()}`)
  await repo.load()
  const forged: MediaUpload = {
    ...child.asset,
    blob: new Blob(['Fake🙂'], { type: 'text/markdown' }),
  }
  await expect(repo.save(library, 0, { assets: [root.asset, forged] })).rejects.toThrow()
  expect(await repo.load()).toEqual({ library: emptyLibrary(), revision: 0 })
  expect(await repo.getMedia(root.asset.meta.id)).toBeUndefined()
  await repo.save(library, 0, { assets })
  const original = Blob.prototype.arrayBuffer
  const reads = vi.spyOn(Blob.prototype, 'arrayBuffer')
  try {
    const next = saveReadingPosition(
      library,
      root.source.id,
      root.source.mediaId,
      { offset: 3, fraction: 0, view: 'source' },
      now,
    )
    await repo.save(next, 1)
    expect(reads).not.toHaveBeenCalled()
  } finally {
    reads.mockRestore()
  }
  const replacement = prepareSource(
    {
      title: 'Replacement',
      url: '',
      format: 'markdown',
      content: 'x'.repeat(root.source.characters),
    },
    now,
  )
  const saved = (await repo.load()).library
  const changed = {
    ...saved,
    sources: [{ ...saved.sources[0]!, mediaId: replacement.source.mediaId }, child.source],
    media: [...saved.media, replacement.asset.meta],
  }
  await expect(repo.save(changed, 2, { assets: [replacement.asset] })).rejects.toThrow()
  expect((await repo.load()).library).toEqual(saved)
  expect(Blob.prototype.arrayBuffer).toBe(original)
  await repo.close()
})

it('keeps excerpts and card progress after parent deletion and detaches cards only when the excerpt is deleted', async () => {
  const { root, child, read, assets } = sample()
  let library = addSource(addSource(fixture(), root.source, root.asset), child.source, child.asset)
  const excerpt = sourceExcerpt(child.source, 'Same🙂', 0, 6)
  library = saveNote(library, { ...input, excerpt }, library.notes[0]!.id)
  library = saveNote(library, {
    ...input,
    type: 'cloze',
    front: '{{c1::Same}}🙂',
    back: 'Context',
    excerpt,
  })
  library = reviewCard(library, library.cards[0]!.id, 3, now)
  const removed = removeSource(library, root.source.id)
  expect(removed.sources).toEqual([{ ...child.source, origin: undefined }])
  expect(removed.notes).toEqual(library.notes)
  expect(removed.cards).toBe(library.cards)
  expect(removed.reviews).toBe(library.reviews)
  expect(await readSource(removed.sources[0]!, removed, read)).toBe('Same🙂')
  librarySchema.parse(removed)
  const noChild = removeSource(removed, child.source.id)
  expect(noChild.notes.every((note) => !note.excerpt)).toBe(true)
  expect(noChild.cards).toBe(library.cards)
  expect(noChild.reviews).toBe(library.reviews)
  const repo = createRepository(`excerpt-delete-${crypto.randomUUID()}`)
  await repo.load()
  await repo.save(library, 0, { assets })
  await repo.save(removed, 1, { reason: '删除材料前' })
  const backup = await repo.getBackup((await repo.listBackups())[0]!.id)
  await repo.save(backup, 2)
  expect((await repo.load()).library).toEqual(library)
  await repo.close()
})

it('round-trips provenance and independent bodies through both backups and media rekeying', async () => {
  const { library, child, selection, read } = sample()
  const data = [
    await parseArchive((await exportArchive(library, read))!),
    parseBackup(await exportBackup(library, read)),
  ]
  for (const backup of data) {
    const restored = rekeyBackup(backup)
    const excerpt = restored.library.sources.find((source) => source.id === child.source.id)!
    expect(excerpt.origin).toEqual({
      ...child.source.origin,
      mediaId: restored.library.sources.find(
        (source) => source.id === child.source.origin!.sourceId,
      )!.mediaId,
    })
    expect(excerpt.mediaId).not.toBe(child.source.mediaId)
    const repo = createRepository(`excerpt-restore-${crypto.randomUUID()}`)
    await repo.load()
    await repo.save(restored.library, 0, { assets: restored.assets })
    expect(await readSource(excerpt, restored.library, (id) => repo.getMedia(id))).toBe(
      selection.quote,
    )
    await repo.close()
  }
})
