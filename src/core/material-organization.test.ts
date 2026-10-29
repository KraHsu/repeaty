import 'fake-indexeddb/auto'
import { expect, it } from 'vitest'
import { fixture } from './test-fixtures'
import { addSource, prepareSource } from './sources'
import { librarySchema } from './model'
import { createRepository } from './storage'
import { operationFor, revertOperation, replayOperation } from './operations'
import { operationHistory } from './operation-history'
import {
  addMaterialFolder,
  renameMaterialFolder,
  removeMaterialFolder,
  moveMaterial,
} from './material-organization'
import { exportArchive, parseArchive } from './archive'

it('moves and reorders folders/materials without changing content identity, origins or learning', () => {
  const prepared = prepareSource({
    title: '原文',
    url: '',
    format: 'markdown',
    content: '正文与历史',
  })
  let library = addSource(fixture(), prepared.source, prepared.asset)
  library = addMaterialFolder(library, '课程')
  const first = library.materialFolders[0]!
  library = addMaterialFolder(library, '章节', first.id)
  const child = library.materialFolders[1]!
  const organized = moveMaterial(library, {
    kind: 'source',
    id: prepared.source.id,
    destination: { folderId: child.id },
  })
  expect(organized.sources[0]).toMatchObject({ ...prepared.source, folderId: child.id })
  expect(organized.cards).toBe(library.cards)
  expect(organized.reviews).toBe(library.reviews)
  expect(() =>
    moveMaterial(organized, { kind: 'folder', id: first.id, destination: { folderId: child.id } }),
  ).toThrow()
  const renamed = renameMaterialFolder(organized, child.id, '新章节')
  expect(renamed.materialFolders[1]!.id).toBe(child.id)
  const unwrapped = removeMaterialFolder(renamed, child.id)
  expect(unwrapped.sources[0]!.folderId).toBe(first.id)
  expect(librarySchema.parse(unwrapped)).toEqual(unwrapped)
})

it('persists empty folders, undo/redo and archive contents across repository reopening', async () => {
  const before = fixture()
  const after = addMaterialFolder(before, '空文件夹')
  const entry = operationFor(before, after, 'local:old', '整理材料')!
  const name = `repeaty-organization-${crypto.randomUUID()}`
  const repo = createRepository(name)
  await repo.save(after, 0, { operationHistory: operationHistory([entry]) })
  await repo.close()
  const reopened = createRepository(name)
  const loaded = await reopened.load()
  expect(loaded.library.materialFolders).toEqual(after.materialFolders)
  const reverted = revertOperation(loaded.library, loaded.operationHistory!.undo[0]!)
  expect(reverted.materialFolders).toEqual([])
  expect(replayOperation(reverted, entry).materialFolders).toEqual(after.materialFolders)
  const archive = await exportArchive(after, async () => undefined)
  expect((await parseArchive(archive!)).library.materialFolders).toEqual(after.materialFolders)
  await reopened.close()
})

it('rejects missing folders and cross-material cycles without committing partial moves', () => {
  const first = prepareSource({ title: '一', url: '', format: 'plain', content: '第一篇正文' })
  const second = prepareSource({ title: '二', url: '', format: 'plain', content: '第二篇正文' })
  const before = addSource(
    addSource(fixture(), first.source, first.asset),
    second.source,
    second.asset,
  )
  expect(() =>
    moveMaterial(before, {
      kind: 'source',
      id: first.source.id,
      destination: { folderId: 'missing' },
    }),
  ).toThrow()
  const next = moveMaterial(before, {
    kind: 'source',
    id: second.source.id,
    destination: { parentSourceId: first.source.id },
  })
  expect(() =>
    moveMaterial(next, {
      kind: 'source',
      id: first.source.id,
      destination: { parentSourceId: second.source.id },
    }),
  ).toThrow()
  expect(before.sources.every((source) => !source.parentSourceId && !source.folderId)).toBe(true)
})
