import { effectScope, nextTick, reactive, ref, shallowRef } from 'vue'
import { afterEach as cleanup, expect, it, vi } from 'vitest'
import { useReadingProgress } from './useReadingProgress'
import type { useLibrary } from './useLibrary'
import type { ReadingUpdate } from '../core/source-data'
import { addSource, prepareSource, saveReadingPosition } from '../core/sources'
import { fixture } from '../core/test-fixtures'

function setup() {
  vi.useFakeTimers()
  const { source, asset } = prepareSource({
    title: 'Reading',
    url: '',
    format: 'plain',
    content: 'reading text\n'.repeat(500),
  })
  const scope = ref('local:test'),
    busy = ref(false),
    library = shallowRef(addSource(fixture(), source, asset))
  const save = vi.fn(async (update: ReadingUpdate, at: Date) => {
    library.value = saveReadingPosition(
      library.value,
      update.sourceId,
      update.mediaId,
      update.position,
      at,
    )
  })
  const workspace = { scope, ready: ref(true), busy, library, saveSourceReading: save }
  const lifecycle = effectScope()
  const progress = lifecycle.run(() =>
    useReadingProgress(workspace as unknown as ReturnType<typeof useLibrary>),
  )!
  scopes.push(lifecycle)
  const update = (offset: number): ReadingUpdate => ({
    sourceId: source.id,
    mediaId: source.mediaId,
    scope: scope.value,
    position: { offset, fraction: 0, view: 'source' },
  })
  return { workspace, save, progress, update }
}
const scopes: ReturnType<typeof effectScope>[] = []
it('holds autosaves across a manual action, then resumes the latest position exactly once', async () => {
  const { progress, update, save, workspace } = setup()
  progress.record(update(100))
  const release = progress.hold()
  progress.record(update(200), true)
  workspace.busy.value = true
  workspace.busy.value = false
  await nextTick()
  await vi.advanceTimersByTimeAsync(1500)
  expect(save).not.toHaveBeenCalled()
  release()
  release()
  await vi.advanceTimersByTimeAsync(0)
  expect(save).toHaveBeenCalledTimes(1)
  expect(workspace.library.value.sources[0]!.reading?.offset).toBe(200)
  const stale = progress.hold()
  progress.clear()
  stale()
  progress.record(update(300))
  await vi.advanceTimersByTimeAsync(700)
  expect(save).toHaveBeenCalledTimes(2)
})
cleanup(() => {
  for (const scope of scopes.splice(0)) scope.stop()
  vi.useRealTimers()
})

it('waits for an in-flight position save before granting a command hold, keeping newer scrolling queued', async () => {
  const { progress, update, save, workspace } = setup()
  let finish!: () => void
  const gate = new Promise<void>((resolve) => {
      finish = resolve
    }),
    original = save.getMockImplementation()!
  save.mockImplementationOnce(async (input, at) => {
    workspace.busy.value = true
    await gate
    await original(input, at)
    workspace.busy.value = false
  })
  progress.record(update(100), true)
  const acquired = vi.fn(),
    hold = progress.holdForAction().then((release) => {
      acquired()
      return release
    })
  progress.record(update(200))
  await vi.advanceTimersByTimeAsync(1500)
  expect(acquired).not.toHaveBeenCalled()
  expect(save).toHaveBeenCalledOnce()
  finish()
  const release = await hold
  expect(workspace.busy.value).toBe(false)
  expect(workspace.library.value.sources[0]!.reading?.offset).toBe(100)
  await vi.advanceTimersByTimeAsync(1000)
  expect(save).toHaveBeenCalledOnce()
  release()
  await vi.advanceTimersByTimeAsync(0)
  expect(save).toHaveBeenCalledTimes(2)
  expect(workspace.library.value.sources[0]!.reading?.offset).toBe(200)
})

it('revokes a command waiting on an old scope and releases failed saves without silently retrying', async () => {
  const { progress, update, save, workspace } = setup()
  let finish!: () => void
  save.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve
      }),
  )
  progress.record(update(100), true)
  const hold = progress.holdForAction(),
    rejected = expect(hold).rejects.toThrow('学习库已变化')
  workspace.scope.value = 'new-library'
  finish()
  await rejected
  progress.record(update(200), true)
  await vi.advanceTimersByTimeAsync(0)
  expect(workspace.library.value.sources[0]!.reading?.offset).toBe(200)
  save.mockRejectedValueOnce(new Error('write-failed'))
  progress.record(update(300), true)
  await expect(progress.holdForAction()).rejects.toThrow('write-failed')
  await vi.advanceTimersByTimeAsync(1500)
  expect(save).toHaveBeenCalledTimes(3)
  expect(progress.pending.get(update(0).sourceId)?.error).toEqual(new Error('write-failed'))
})

it('captures a reactive position without retaining its proxy or mutable input', async () => {
  const { progress, update, workspace } = setup()
  const input = reactive(update(400))
  progress.record(input)
  input.position.offset = 800
  await vi.advanceTimersByTimeAsync(700)
  expect(workspace.library.value.sources[0]!.reading?.offset).toBe(400)
  expect(progress.pending.size).toBe(0)
})

it('acknowledges only the position included in a queue action while retaining newer scrolling', async () => {
  const { progress, update } = setup()
  progress.record(update(100))
  const first = progress.pending.get(update(0).sourceId)!
  progress.record(update(200))
  progress.acknowledge(update(0).sourceId, first.token)
  expect(progress.pending.get(update(0).sourceId)!.update.position.offset).toBe(200)
  progress.acknowledge(update(0).sourceId, progress.pending.get(update(0).sourceId)!.token)
  expect(progress.pending.size).toBe(0)
})

it('retains a detached versioned locator and saves page changes at the same text offset', async () => {
  const { progress, update, workspace, save } = setup()
  workspace.library.value = {
    ...workspace.library.value,
    sources: workspace.library.value.sources.map((source) => ({
      ...source,
      document: {
        schemaVersion: 1,
        providerId: 'pdf-test',
        format: 'pdf',
        originalMediaId: source.mediaId,
      },
    })),
  }
  const input = reactive(update(400))
  input.position.locator = {
    schemaVersion: 1,
    sourceId: input.sourceId,
    versionId: input.mediaId,
    kind: 'pdf',
    regions: [{ page: 2, x: 0, y: 0, width: 0.5, height: 0.2 }],
  }
  progress.record(input)
  input.position.locator.regions[0]!.page = 3
  await vi.advanceTimersByTimeAsync(700)
  expect(workspace.library.value.sources[0]!.reading?.locator).toMatchObject({
    regions: [{ page: 2 }],
  })
  progress.record(input)
  await vi.advanceTimersByTimeAsync(700)
  expect(save).toHaveBeenCalledTimes(2)
  expect(workspace.library.value.sources[0]!.reading?.locator).toMatchObject({
    regions: [{ page: 3 }],
  })
})

it('coalesces scrolling, waits for a formal save and preserves the newest position while a write is pending', async () => {
  const { workspace, save, progress, update } = setup()
  const cards = workspace.library.value.cards,
    reviews = workspace.library.value.reviews
  workspace.busy.value = true
  for (let index = 0; index < 50; index++) progress.record(update(index * 10))
  await vi.advanceTimersByTimeAsync(700)
  expect(save).not.toHaveBeenCalled()
  workspace.busy.value = false
  await nextTick()
  await vi.advanceTimersByTimeAsync(0)
  expect(save).toHaveBeenCalledOnce()
  expect(workspace.library.value.sources[0]!.reading?.offset).toBe(490)
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const original = save.getMockImplementation()!
  save.mockImplementationOnce(async (input, at) => {
    workspace.busy.value = true
    await gate
    await original(input, at)
    workspace.busy.value = false
  })
  progress.record(update(800), true)
  const pending = progress.pending.get(update(0).sourceId)
  progress.record(update(800))
  expect(progress.pending.get(update(0).sourceId)).toBe(pending)
  progress.record(update(900))
  release()
  await vi.advanceTimersByTimeAsync(0)
  expect(workspace.library.value.sources[0]!.reading?.offset).toBe(900)
  expect(progress.pending.size).toBe(0)
  expect(workspace.library.value.cards).toBe(cards)
  expect(workspace.library.value.reviews).toBe(reviews)
})

it('retains a failed write for explicit retry instead of repeatedly writing or dropping its position', async () => {
  const { progress, update, save, workspace } = setup()
  save.mockRejectedValueOnce(new Error('offline'))
  progress.record(update(400), true)
  await vi.advanceTimersByTimeAsync(10000)
  expect(save).toHaveBeenCalledOnce()
  expect(progress.pending.get(update(0).sourceId)?.error).toBeInstanceOf(Error)
  expect(workspace.library.value.sources[0]!.reading).toBeUndefined()
  await progress.flush()
  expect(save).toHaveBeenCalledTimes(2)
  expect(progress.pending.size).toBe(0)
  expect(workspace.library.value.sources[0]!.reading?.offset).toBe(400)
})

it('clears the active-save marker when a position writer throws synchronously', async () => {
  const { progress, update, save } = setup()
  save.mockImplementationOnce(() => {
    throw new Error('sync-write-failed')
  })
  progress.record(update(100), true)
  await nextTick()
  expect(progress.savingId.value).toBe('')
  expect(progress.pending.get(update(0).sourceId)?.error).toEqual(new Error('sync-write-failed'))
  await progress.flush()
  expect(progress.pending.size).toBe(0)
  expect(save).toHaveBeenCalledTimes(2)
})

it('revokes queued work on scope changes and restore, and prunes deleted snapshots', async () => {
  const { progress, update, save, workspace } = setup()
  progress.record(update(100))
  workspace.scope.value = 'https://server:user'
  await vi.advanceTimersByTimeAsync(1000)
  expect(save).not.toHaveBeenCalled()
  expect(progress.pending.size).toBe(0)
  progress.record(update(200))
  workspace.busy.value = true
  await vi.advanceTimersByTimeAsync(700)
  workspace.busy.value = false
  await nextTick()
  progress.clear()
  await vi.advanceTimersByTimeAsync(1000)
  expect(save).not.toHaveBeenCalled()
  progress.record(update(300))
  workspace.library.value = { ...workspace.library.value, sources: [] }
  expect(progress.pending.size).toBe(0)
  await vi.advanceTimersByTimeAsync(1000)
  expect(save).not.toHaveBeenCalled()
})

it('ignores a late failure from a previous scope while the new scope is saving', async () => {
  const { progress, update, save, workspace } = setup()
  let rejectOld!: (error: Error) => void, releaseNew!: () => void
  const original = save.getMockImplementation()!
  save.mockImplementationOnce(() => new Promise<void>((_, reject) => (rejectOld = reject)))
  progress.record(update(100), true)
  workspace.scope.value = 'https://server:another-user'
  save.mockImplementationOnce(async (input, at) => {
    await new Promise<void>((resolve) => (releaseNew = resolve))
    await original(input, at)
  })
  progress.record(update(500), true)
  rejectOld(new Error('old connection closed'))
  await vi.advanceTimersByTimeAsync(0)
  expect(progress.savingId.value).toBe(update(0).sourceId)
  expect(progress.pending.get(update(0).sourceId)?.error).toBeUndefined()
  releaseNew()
  await vi.advanceTimersByTimeAsync(0)
  expect(progress.pending.size).toBe(0)
  expect(workspace.library.value.sources[0]!.reading?.offset).toBe(500)
})
