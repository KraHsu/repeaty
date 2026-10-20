import 'fake-indexeddb/auto'
import { afterEach, expect, it, vi } from 'vitest'
import { createRepository } from '../core/storage'
import { fixture } from '../core/test-fixtures'
import { addSource, prepareSource } from '../core/sources'
import type { SourceDetailsUpdate } from '../core/source-data'
import { useLibrary } from './useLibrary'

const factory = vi.hoisted(() => vi.fn())
vi.mock('@repeaty-platform', () => ({ createWorkspaceRepository: factory }))
const repositories: ReturnType<typeof createRepository>[] = []
afterEach(async () => {
  for (const repo of repositories.splice(0)) await repo.close()
  factory.mockReset()
  vi.restoreAllMocks()
})
async function setup() {
  const { source, asset } = prepareSource({
    title: 'Original',
    url: '',
    format: 'plain',
    content: 'Context 中文🙂\n'.repeat(100),
  })
  source.queue = { state: 'active', availableOn: '2099-12-31' }
  source.priority = 'high'
  source.readingIntervalDays = 14
  const library = addSource(fixture(), source, asset)
  const name = `source-details-service-${crypto.randomUUID()}`
  const repo = createRepository(name)
  repositories.push(repo)
  await repo.load()
  await repo.save(library, 0, { assets: [asset] })
  factory.mockResolvedValueOnce(repo)
  const workspace = useLibrary()
  await workspace.init()
  const input: SourceDetailsUpdate = {
    sourceId: source.id,
    mediaId: source.mediaId,
    scope: workspace.scope.value,
    before: { title: source.title, url: source.url },
    details: { title: 'Renamed', url: 'https://example.org/renamed' },
    position: { offset: 100, fraction: 0, view: 'source' },
  }
  return { repo, library, asset, workspace, input, name }
}

it('commits details and captured position atomically with a restorable checkpoint and refuses stale forms', async () => {
  const { repo, library, workspace, input } = await setup()
  for (const update of [
    { ...input, mediaId: 'replaced' },
    { ...input, before: { ...input.before, title: 'Stale' } },
    { ...input, details: { title: '', url: '' } },
    { ...input, position: { ...input.position!, offset: 250000 } },
  ])
    await expect(workspace.editSourceDetails(update)).rejects.toThrow()
  expect((await repo.load()).library).toEqual(library)
  await workspace.editSourceDetails(input)
  const saved = await repo.load()
  expect(saved.revision).toBe(2)
  expect(saved.library.sources[0]).toEqual({
    ...library.sources[0],
    ...input.details,
    reading: { ...input.position, updatedAt: expect.any(String) },
  })
  expect(workspace.library.value).toEqual(saved.library)
  expect(saved.library.cards).toEqual(library.cards)
  expect(saved.library.reviews).toEqual(library.reviews)
  const backup = (await repo.listBackups()).find((b) => b.revision === 1)!
  expect(await repo.getBackup(backup.id)).toEqual(library)
  await expect(workspace.editSourceDetails(input)).rejects.toThrow('材料信息已变化')
  expect((await repo.load()).revision).toBe(2)
})

it('retains both memory and durable data after a quota failure and can safely retry the same form', async () => {
  const { repo, library, workspace, input } = await setup()
  const original = IDBObjectStore.prototype.put
  const fail = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
    this: IDBObjectStore,
    ...args: Parameters<typeof original>
  ) {
    if (this.name === 'sources')
      throw new DOMException('Synthetic full storage', 'QuotaExceededError')
    return original.apply(this, args)
  })
  await expect(workspace.editSourceDetails(input)).rejects.toThrow('存储空间不足')
  expect((await repo.load()).library).toEqual(library)
  expect(workspace.library.value).toEqual(library)
  fail.mockRestore()
  await workspace.editSourceDetails(input)
  expect((await repo.load()).library.sources[0]).toMatchObject({
    ...input.details,
    reading: input.position,
  })
})

it('rejects a pending metadata edit when the workspace changes before the write begins', async () => {
  const { library, asset, workspace, input, name } = await setup()
  const other = createRepository(`${name}-other`)
  repositories.push(other)
  await other.load()
  await other.save(library, 0, { assets: [asset] })
  factory.mockResolvedValueOnce(other)
  const rejected = expect(workspace.editSourceDetails(input)).rejects.toThrow('学习库已变化')
  await workspace.init()
  await rejected
  expect(workspace.scope.value).toBe(other.scope())
  expect((await other.load()).library).toEqual(library)
  const original = createRepository(name)
  repositories.push(original)
  expect((await original.load()).library).toEqual(library)
  await expect(workspace.editSourceDetails(input)).rejects.toThrow('学习库已变化')
})
