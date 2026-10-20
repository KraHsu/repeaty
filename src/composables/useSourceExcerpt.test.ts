import 'fake-indexeddb/auto'
import { afterEach, expect, it, vi } from 'vitest'
import { createRepository } from '../core/storage'
import { emptyLibrary } from '../core/model'
import { addSource, prepareSource, sourceExcerpt } from '../core/sources'
import { useLibrary } from './useLibrary'

const factory = vi.hoisted(() => vi.fn())
vi.mock('@repeaty-platform', () => ({ createWorkspaceRepository: factory }))
const repositories: ReturnType<typeof createRepository>[] = []
afterEach(async () => {
  for (const repository of repositories.splice(0)) await repository.close()
  factory.mockReset()
  vi.restoreAllMocks()
})
async function setup() {
  const text = 'Same🙂\nSame🙂\n' + '长文\n'.repeat(100)
  const { source, asset } = prepareSource({
    title: 'Original',
    url: '',
    format: 'plain',
    content: text,
  })
  const library = addSource(emptyLibrary(), source, asset)
  const name = `excerpt-service-${crypto.randomUUID()}`
  const repo = createRepository(name)
  repositories.push(repo)
  await repo.load()
  await repo.save(library, 0, { assets: [asset] })
  factory.mockResolvedValueOnce(repo)
  const workspace = useLibrary()
  await workspace.init()
  const input = {
    title: 'Saved excerpt',
    excerpt: sourceExcerpt(source, text, 7, 13),
    mediaId: source.mediaId,
    scope: workspace.scope.value,
    position: { offset: 20, fraction: 0, view: 'source' as const },
  }
  return { repo, workspace, library, input, name }
}

it('saves a snapshot and parent position together without requiring cards or decks', async () => {
  const { workspace, repo, library, input } = await setup()
  await workspace.saveSourceExcerpt(input)
  const saved = await repo.load()
  expect(saved.revision).toBe(2)
  expect(saved.library.sources[0]!.reading).toMatchObject(input.position)
  const child = saved.library.sources[1]!
  expect(child).toMatchObject({
    kind: 'excerpt',
    origin: { sourceId: input.excerpt.sourceId, start: 7, end: 13 },
  })
  expect(await workspace.getSource(child.id)).toBe('Same🙂')
  expect(saved.library.decks).toEqual([])
  expect(saved.library.cards).toEqual([])
  expect(await repo.getBackup((await repo.listBackups())[0]!.id)).toEqual(library)
})

it('keeps the library and assets unchanged after stale selection, malformed position or quota failure', async () => {
  const { workspace, repo, library, input } = await setup()
  for (const invalid of [
    { ...input, scope: 'other' },
    { ...input, mediaId: 'stale' },
    { ...input, excerpt: { ...input.excerpt, quote: 'Fake🙂' } },
    { ...input, position: { ...input.position, offset: 250000 } },
  ])
    await expect(workspace.saveSourceExcerpt(invalid)).rejects.toThrow()
  const backups = await repo.listBackups()
  const original = IDBObjectStore.prototype.put
  const fail = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
    this: IDBObjectStore,
    ...args: Parameters<typeof original>
  ) {
    if (this.name === 'sources')
      throw new DOMException('Synthetic quota failure', 'QuotaExceededError')
    return original.apply(this, args)
  })
  await expect(workspace.saveSourceExcerpt(input)).rejects.toThrow('存储空间不足')
  fail.mockRestore()
  expect(await repo.load()).toEqual({ library, revision: 1 })
  expect(workspace.library.value).toEqual(library)
  expect(await repo.listBackups()).toEqual(backups)
  await workspace.saveSourceExcerpt(input)
  expect((await repo.load()).library.sources).toHaveLength(2)
})

it('refuses an excerpt write queued across a workspace switch', async () => {
  const { workspace, library, input, name } = await setup()
  const other = createRepository(`excerpt-other-${crypto.randomUUID()}`)
  repositories.push(other)
  factory.mockResolvedValueOnce(other)
  const rejected = expect(workspace.saveSourceExcerpt(input)).rejects.toThrow('学习库已变化')
  await workspace.init()
  await rejected
  const original = createRepository(name)
  repositories.push(original)
  expect((await original.load()).library).toEqual(library)
  expect((await other.load()).library.sources).toEqual([])
})
