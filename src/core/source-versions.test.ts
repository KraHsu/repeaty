import { expect, it } from 'vitest'
import { fixture, input, now } from './test-fixtures'
import {
  addSource,
  prepareSource,
  prepareSourceExcerpt,
  sourceExcerpt,
  replaceSourceContent,
  readSource,
  saveReadingPosition,
  validateSourceOrigins,
} from './sources'
import { sourceAtVersion, referencedSource } from './source-data'
import { librarySchema, pruneMedia, saveNote } from './model'
import { sourceContextPath } from './source-tree'
import { excerptsForSource } from './source-navigation'
import { exportBackup, parseBackup, rekeyBackup } from './backups'

it('keeps old quotations, positions, schedules and cards on their snapshots after repeated external edits', async () => {
  const body = '序言🙂\n第一版内容\n尾声'
  const root = prepareSource({ title: '材料', url: '', format: 'markdown', content: body }, now)
  const selection = sourceExcerpt(root.source, body, 5, 10)
  const child = prepareSourceExcerpt(root.source, body, selection, '摘录', now)
  let library = addSource(addSource(fixture(), root.source, root.asset), child.source, child.asset)
  library = saveNote(library, { ...input, excerpt: selection })
  library = saveReadingPosition(
    library,
    root.source.id,
    root.source.mediaId,
    { offset: 7, fraction: 0, view: 'source' },
    now,
  )
  library.sources[0] = {
    ...library.sources[0]!,
    queue: { state: 'active', availableOn: '2026-11-01' },
    priority: 'high',
    adaptiveReading: {
      intervalDays: 9,
      factor: 2,
      lastReadOn: '2026-10-01',
      readCount: 4,
      feedback: 'good',
    },
  }
  const before = library
  const changed = replaceSourceContent(
    library,
    root.source.id,
    { title: '新版', url: '', format: 'markdown', content: '更短的新正文' },
    now,
  )
  library = changed.library
  librarySchema.parse(library)
  const source = library.sources[0]!
  expect(source.id).toBe(root.source.id)
  expect(source.reading).toBeUndefined()
  expect(source.versions![0]!.reading).toEqual(before.sources[0]!.reading)
  expect(source.queue).toEqual(before.sources[0]!.queue)
  expect(source.adaptiveReading).toEqual(before.sources[0]!.adaptiveReading)
  expect(library.cards).toBe(before.cards)
  expect(library.notes).toBe(before.notes)
  const blobs = [root.asset, child.asset, changed.asset]
  const read = async (id: string) => blobs.find((asset) => asset.meta.id === id)?.blob
  expect(await readSource(sourceAtVersion(source, root.source.mediaId)!, library, read)).toBe(body)
  expect(referencedSource(source, {})!.mediaId).toBe(root.source.mediaId)
  expect(sourceAtVersion(source, 'unknown')).toBeUndefined()
  expect(sourceContextPath(library.sources, child.source)[1]!.source.mediaId).toBe(
    root.source.mediaId,
  )
  expect(excerptsForSource(library, source.id)).toEqual([])
  await validateSourceOrigins(library, new Set([source.id]), read)
  expect(pruneMedia(library).media).toEqual(library.media)
  const second = replaceSourceContent(library, source.id, {
    title: '第三版',
    url: '',
    format: 'plain',
    content: 'plain text',
  })
  librarySchema.parse(second.library)
  expect(second.source.versions!.map((version) => version.mediaId)).toEqual([
    root.source.mediaId,
    source.mediaId,
  ])
  const restored = rekeyBackup(parseBackup(await exportBackup(library, read)))
  librarySchema.parse(restored.library)
  const restoredRoot = restored.library.sources[0]!
  expect(restoredRoot.versions![0]!.mediaId).not.toBe(root.source.mediaId)
  expect(restored.library.notes.at(-1)!.excerpt!.mediaId).toBe(restoredRoot.versions![0]!.mediaId)
  await validateSourceOrigins(
    restored.library,
    new Set(restored.library.sources.map((source) => source.id)),
    async (id) => restored.assets.find((asset) => asset.meta.id === id)?.blob,
  )
})

it('treats an edited excerpt as derived text while its original version and descendant quotes stay verbatim', async () => {
  const root = prepareSource(
    { title: 'Root', url: '', format: 'plain', content: 'Original paragraph' },
    now,
  )
  const child = prepareSourceExcerpt(
    root.source,
    'Original paragraph',
    sourceExcerpt(root.source, 'Original paragraph', 0, 8),
    'Excerpt',
    now,
  )
  let library = addSource(addSource(fixture(), root.source, root.asset), child.source, child.asset)
  const selection = sourceExcerpt(child.source, 'Original', 0, 8)
  library = saveNote(library, { ...input, excerpt: selection })
  const edited = replaceSourceContent(library, child.source.id, {
    title: 'My words',
    url: '',
    format: 'plain',
    content: 'An edited explanation',
  })
  librarySchema.parse(edited.library)
  expect(edited.source.derived).toBe(true)
  expect(edited.source.origin).toEqual(child.source.origin)
  const path = sourceContextPath(
    edited.library.sources,
    edited.source,
    sourceExcerpt(edited.source, 'An edited explanation', 0, 2),
  )
  expect(path[1]!.excerpt).toBeUndefined()
  const quotedPath = sourceContextPath(edited.library.sources, edited.source, selection)
  expect(quotedPath[0]!.source.mediaId).toBe(child.source.mediaId)
  expect(quotedPath[1]!.excerpt!.quote).toBe('Original')
  await validateSourceOrigins(
    edited.library,
    new Set([child.source.id]),
    async (id) =>
      [root.asset, child.asset, edited.asset].find((asset) => asset.meta.id === id)?.blob,
  )
})
