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
