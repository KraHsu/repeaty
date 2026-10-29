import { createPinia } from 'pinia'
import 'fake-indexeddb/auto'
import { afterEach, expect, it, vi } from 'vitest'
import { createRepository } from '../core/storage'
import { fixture } from '../core/test-fixtures'
import { addSource, prepareSource } from '../core/sources'
import { useLibrary } from './useLibrary'
import { sourceArrangement } from '../core/reading-operations'

const factory = vi.hoisted(() => vi.fn())
vi.mock('@repeaty-platform', () => ({ createWorkspaceRepository: factory }))
const repositories: ReturnType<typeof createRepository>[] = []
afterEach(async () => {
  for (const repository of repositories.splice(0)) await repository.close()
  factory.mockReset()
})

it('commits a whole batch and undoes it while preserving later details and card ratings', async () => {
  const { workspace, repository, input } = await setup()
  await workspace.saveSource(
    { title: 'Second', url: '', format: 'plain', content: 'Second context' },
    input.scope,
  )
  const before = (await repository.load()).library
  const targets = before.sources.map((s) => ({
    id: s.id,
    mediaId: s.mediaId,
    before: sourceArrangement(s),
  }))
  await workspace.arrangeSources({
    targets,
    action: { type: 'archive' },
    scope: input.scope,
    reading: input,
  })
  expect(workspace.canUndoReading.value).toBe(true)
  expect(
    (await repository.load()).library.sources.every((s) => s.queue?.state === 'archived'),
  ).toBe(true)
  const source = workspace.library.value.sources[0]!
  await workspace.editSourceDetails({
    sourceId: source.id,
    mediaId: source.mediaId,
    scope: input.scope,
    before: { title: source.title, url: source.url },
    details: { title: 'Later title', url: '' },
  })
  await workspace.review(before.cards[0]!.id, 3)
  const rated = (await repository.load()).library
  await workspace.undoReadingArrangement(input.scope)
  const after = (await repository.load()).library
  expect(after.sources.map(sourceArrangement)).toEqual(before.sources.map(sourceArrangement))
  expect(after.sources[0]!.title).toBe('Later title')
  expect(after.sources[0]!.reading).toEqual(rated.sources[0]!.reading)
  expect(after.cards).toEqual(rated.cards)
  expect(after.reviews).toEqual(rated.reviews)
  expect(workspace.canUndoReading.value).toBe(false)
  await expect(workspace.undoReadingArrangement(input.scope)).rejects.toThrow()
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
  const workspace = useLibrary(createPinia())
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

it('retains the last undo after failed or no-op batches, and clears it when replacing a library', async () => {
  const { workspace, repository, input } = await setup()
  await workspace.arrangeSource(input)
  const undo = workspace.readingUndo.value
  const targets = workspace.library.value.sources.map((source) => ({
    id: source.id,
    mediaId: source.mediaId,
    before: sourceArrangement(source),
  }))
  await workspace.arrangeSources({ targets, action: { type: 'archive' }, scope: input.scope })
  expect(workspace.readingUndo.value?.id).toBe(undo?.id)
  await expect(
    workspace.arrangeSources({
      targets,
      action: { type: 'priority', priority: 'high' },
      scope: 'another-library',
    }),
  ).rejects.toThrow('学习库')
  const original = IDBObjectStore.prototype.put
  const fail = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
    this: IDBObjectStore,
    ...args: Parameters<typeof original>
  ) {
    if (this.name === 'sources')
      throw new DOMException('Synthetic full storage', 'QuotaExceededError')
    return original.apply(this, args)
  })
  try {
    await expect(workspace.undoReadingArrangement(input.scope)).rejects.toThrow('存储空间不足')
  } finally {
    fail.mockRestore()
  }
  expect(workspace.canUndoReading.value).toBe(true)
  expect(workspace.readingUndo.value?.id).toBe(undo?.id)
  expect((await repository.load()).library.sources[0]!.queue?.state).toBe('archived')
  await workspace.undoReadingArrangement(input.scope)
  expect((await repository.load()).library.sources[0]!.queue).toBeUndefined()
  await workspace.arrangeSource(input)
  const saved = (await repository.load()).library
  await workspace.restoreSnapshot(saved)
  expect(workspace.canUndoReading.value).toBe(false)
})
