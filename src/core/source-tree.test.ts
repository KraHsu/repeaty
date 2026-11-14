import 'fake-indexeddb/auto'
import { expect, it } from 'vitest'
import { emptyLibrary, librarySchema, saveNote } from './model'
import { fixture, input, now } from './test-fixtures'
import {
  addSource,
  prepareSource,
  prepareSourceExcerpt,
  removeSource,
  sourceExcerpt,
} from './sources'
import { sourceContextPath } from './source-tree'
import { arrangeSource } from './source-queue'
import { createRepository } from './storage'
import { exportArchive, parseArchive } from './archive'
import { exportBackup, parseBackup, rekeyBackup } from './backups'
import { reviewCard } from './scheduler'

function nested() {
  const text = '引言🙂\nRepeated text\nRepeated text 变量🙂\n结尾'
  const root = prepareSource({ title: 'Original', url: '', format: 'markdown', content: text }, now)
  const start = text.lastIndexOf('Repeated')
  const paragraph = sourceExcerpt(root.source, text, start, text.indexOf('\n结尾'))
  const child = prepareSourceExcerpt(root.source, text, paragraph, 'Paragraph', now)
  const at = paragraph.quote.indexOf('变量')
  const selection = sourceExcerpt(child.source, paragraph.quote, at, at + '变量🙂'.length)
  const leaf = prepareSourceExcerpt(child.source, paragraph.quote, selection, 'Key idea', now)
  const assets = [root.asset, child.asset, leaf.asset]
  let library = fixture()
  for (const node of [root, child, leaf]) library = addSource(library, node.source, node.asset)
  return { library, root, child, leaf, assets, text, paragraph, selection }
}

it('translates a selection through every immutable ancestor, including repeated Unicode text', () => {
  const { library, root, child, leaf, text, paragraph, selection } = nested()
  const path = sourceContextPath(
    library.sources,
    leaf.source,
    sourceExcerpt(leaf.source, '变量🙂', 0, 4),
  )
  expect(path.map((entry) => entry.source.id)).toEqual([
    leaf.source.id,
    child.source.id,
    root.source.id,
  ])
  expect(path[1]!.excerpt).toEqual(selection)
  expect(path[2]!.excerpt).toEqual({
    sourceId: root.source.id,
    mediaId: root.source.mediaId,
    start: paragraph.start + selection.start,
    end: paragraph.start + selection.end,
    quote: '变量🙂',
  })
  for (const entry of path) {
    const body =
      entry.source.id === root.source.id
        ? text
        : entry.source.id === child.source.id
          ? paragraph.quote
          : selection.quote
    expect(body.slice(entry.excerpt!.start, entry.excerpt!.end)).toBe('变量🙂')
  }
})

it('rejects cycles and depth above 32 without rejecting a detached or 32-level tree', () => {
  const root = prepareSource({ title: 'Root', url: '', format: 'plain', content: 'Same🙂' }, now)
  let library = addSource(emptyLibrary(), root.source, root.asset),
    parent = root.source
  for (let level = 1; level <= 32; level++) {
    const child = prepareSourceExcerpt(
      parent,
      'Same🙂',
      sourceExcerpt(parent, 'Same🙂', 0, 6),
      `Level ${level}`,
      now,
    )
    library = addSource(library, child.source, child.asset)
    parent = child.source
  }
  librarySchema.parse(library)
  const extra = prepareSourceExcerpt(
    parent,
    'Same🙂',
    sourceExcerpt(parent, 'Same🙂', 0, 6),
    'Too deep',
    now,
  )
  expect(() => librarySchema.parse(addSource(library, extra.source, extra.asset))).toThrow('32')
  expect(() =>
    librarySchema.parse({
      ...library,
      sources: library.sources.map((source) =>
        source.id === root.source.id
          ? { ...source, kind: 'excerpt', origin: { sourceId: parent.id, start: 0, end: 6 } }
          : source,
      ),
    }),
  ).toThrow('循环')
  const detached = removeSource(library, library.sources[10]!.id)
  librarySchema.parse(detached)
  expect(sourceContextPath(detached.sources, parent).length).toBe(22)
})

it('keeps descendants, cards, reading positions and arrangements when a middle excerpt is deleted; backups restore the whole tree', async () => {
  const { root, child, leaf, assets, text, paragraph, selection } = nested()
  let library = fixture()
  for (const node of [root, child, leaf]) library = addSource(library, node.source, node.asset)
  const excerpt = sourceExcerpt(leaf.source, '变量🙂', 0, 4)
  library = saveNote(library, { ...input, excerpt }, library.notes[0]!.id)
  library = reviewCard(library, library.cards[0]!.id, 3, now)
  library = arrangeSource(library, child.source.id, child.source.mediaId, { type: 'archive' }, now)
  library = arrangeSource(
    library,
    leaf.source.id,
    leaf.source.mediaId,
    { type: 'defer', date: '2026-10-25' },
    now,
  )
  const name = `source-tree-${crypto.randomUUID()}`
  const repo = createRepository(name)
  await repo.load()
  await repo.save(library, 0, { assets })
  const detached = removeSource(library, child.source.id)
  await repo.save(detached, 1, { reason: '删除材料前' })
  expect(detached.sources.find((source) => source.id === leaf.source.id)).toEqual({
    ...library.sources[2]!,
    origin: undefined,
  })
  expect(detached.cards).toBe(library.cards)
  expect(detached.reviews).toBe(library.reviews)
  expect(detached.notes[0]!.excerpt).toEqual(excerpt)
  await repo.close()
  const reopened = createRepository(name)
  expect((await reopened.load()).library).toEqual(detached)
  await reopened.close()
  const read = async (id: string) => assets.find((entry) => entry.meta.id === id)?.blob
  for (const backup of [
    parseBackup(await exportBackup(library, read)),
    await parseArchive((await exportArchive(library, read))!),
  ]) {
    const restored = rekeyBackup(backup)
    const verify = createRepository(`source-tree-restore-${crypto.randomUUID()}`)
    await verify.load()
    await verify.save(restored.library, 0, { assets: restored.assets })
    const bodies = [text, paragraph.quote, selection.quote]
    for (let i = 0; i < 3; i++)
      expect(await (await verify.getMedia(restored.library.sources[i]!.mediaId))!.text()).toBe(
        bodies[i],
      )
    expect(restored.library.sources.map((source) => source.origin)).toEqual(
      library.sources.map((source) =>
        source.origin
          ? {
              ...source.origin,
              mediaId: restored.library.sources.find(
                (entry) => entry.id === source.origin!.sourceId,
              )!.mediaId,
            }
          : undefined,
      ),
    )
    expect(restored.library.cards).toEqual(library.cards)
    await verify.close()
  }
})
