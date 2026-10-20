import 'fake-indexeddb/auto'
import { afterEach, expect, it, vi } from 'vitest'
import { createRepository } from '../core/storage'
import { fixture } from '../core/test-fixtures'
import { addSource, prepareSource } from '../core/sources'
import { useLibrary } from './useLibrary'

const factory = vi.hoisted(() => vi.fn())
vi.mock('@repeaty-platform', () => ({ createWorkspaceRepository: factory }))
const repositories: ReturnType<typeof createRepository>[] = []
afterEach(async () => {
  for (const repository of repositories.splice(0)) await repository.close()
  factory.mockReset()
})
async function setup() {
  const { source, asset } = prepareSource({
    title: 'Scoped material',
    url: '',
    format: 'plain',
    content: 'Reading context\n'.repeat(100),
  })
  const library = addSource(fixture(), source, asset)
  const name = `source-queue-service-${crypto.randomUUID()}`
  const repository = createRepository(name)
  repositories.push(repository)
  await repository.load()
  await repository.save(library, 0, { assets: [asset] })
  factory.mockResolvedValueOnce(repository)
  const workspace = useLibrary()
  await workspace.init()
  expect(workspace.ready.value).toBe(true)
  const input = {
    sourceId: source.id,
    mediaId: source.mediaId,
    scope: workspace.scope.value,
    action: { type: 'archive' as const },
    position: { offset: 100, fraction: 0, view: 'source' as const },
  }
  return { workspace, repository, library, input, name }
}

it('commits an arrangement and position together and refuses invalid snapshot or position updates', async () => {
  const { workspace, repository, library, input } = await setup()
  await expect(workspace.arrangeSource({ ...input, mediaId: 'stale' })).rejects.toThrow()
  await expect(
    workspace.arrangeSource({ ...input, position: { ...input.position, offset: 250000 } }),
  ).rejects.toThrow()
  expect((await repository.load()).library).toEqual(library)
  await workspace.arrangeSource(input)
  const stored = await repository.load()
  expect(stored.revision).toBe(2)
  expect(stored.library.sources[0]).toMatchObject({
    queue: { state: 'archived' },
    reading: input.position,
  })
  expect(stored.library.cards).toEqual(library.cards)
  expect(stored.library.reviews).toEqual(library.reviews)
  const snapshots = await repository.listBackups()
  const previous = snapshots.find((entry) => entry.revision === 1)!
  expect(await repository.getBackup(previous.id)).toEqual(library)
})

it('saves priority and current position atomically and preserves priority in later reading saves', async () => {
  const { workspace, repository, library, input } = await setup()
  const original = IDBObjectStore.prototype.put
  const fail = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
    this: IDBObjectStore,
    ...args: Parameters<typeof original>
  ) {
    if (this.name === 'sources')
      throw new DOMException('Synthetic quota failure', 'QuotaExceededError')
    return original.apply(this, args)
  })
  const priority = { ...input, action: { type: 'priority' as const, priority: 'high' as const } }
  try {
    await expect(workspace.arrangeSource(priority)).rejects.toThrow('存储空间不足')
  } finally {
    fail.mockRestore()
  }
  expect((await repository.load()).library).toEqual(library)
  await workspace.arrangeSource(priority)
  const saved = await repository.load()
  expect(saved.library.sources[0]).toMatchObject({ priority: 'high', reading: input.position })
  expect(saved.library.sources[0]!.queue).toBeUndefined()
  await workspace.saveSourceReading(
    { ...input, position: { ...input.position, offset: 300 } },
    new Date(),
  )
  const next = (await repository.load()).library
  expect(next.sources[0]!.priority).toBe('high')
  expect(next.sources[0]!.reading!.offset).toBe(300)
  expect(next.cards).toEqual(library.cards)
  expect(next.reviews).toEqual(library.reviews)
})

it.each(['arrangement', 'reading'] as const)(
  'rejects a delayed %s update when the workspace switches before its write begins',
  async (operation) => {
    const { workspace, library, input, name } = await setup()
    const other = createRepository(`${name}-other`)
    repositories.push(other)
    await other.load()
    await other.save(library, 0, {
      assets: [
        {
          meta: library.media[0]!,
          blob: new Blob(['Reading context\n'.repeat(100)], { type: 'text/plain' }),
        },
      ],
    })
    factory.mockResolvedValueOnce(other)
    const update = () =>
      operation === 'arrangement'
        ? workspace.arrangeSource(input)
        : workspace.saveSourceReading(input, new Date())
    const rejected = expect(update()).rejects.toThrow()
    await workspace.init()
    await rejected
    expect(workspace.scope.value).toBe(other.scope())
    expect((await other.load()).library).toEqual(library)
    const original = createRepository(name)
    repositories.push(original)
    expect((await original.load()).library).toEqual(library)
    await expect(update()).rejects.toThrow()
    expect((await other.load()).revision).toBe(1)
  },
)
