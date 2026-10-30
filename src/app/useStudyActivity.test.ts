// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref, shallowRef } from 'vue'
import { useStudyActivity } from './useStudyActivity'
import type { useLibrary } from '../composables/useLibrary'
import { fixture } from '../core/test-fixtures'
import { studySettings } from '../core/study-settings'
import type { StudyActivity } from '../core/study-data'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})
it('starts coverage after load, flushes by scope and removes timers/listeners on disposal', async () => {
  vi.useFakeTimers()
  vi.spyOn(document, 'hasFocus').mockReturnValue(true)
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  let monotonic = 0
  vi.spyOn(performance, 'now').mockImplementation(() => monotonic)
  const library = shallowRef(fixture()),
    scope = ref('a'),
    ready = ref(true),
    busy = ref(true)
  const begin = vi.fn(async (expected: string) => {
    if (expected !== scope.value) throw new Error('scope')
    library.value = {
      ...library.value,
      studySettings: [
        { ...studySettings(library.value), statisticsSince: new Date().toISOString() },
      ],
    }
  })
  const record = vi.fn(async (_rows: StudyActivity[], expected: string) => {
    if (expected !== scope.value) throw new Error('scope')
  })
  const workspace = {
    library,
    scope,
    ready,
    busy,
    beginStudyStatistics: begin,
    recordStudyActivity: record,
  } as unknown as ReturnType<typeof useLibrary>
  const effect = effectScope(),
    kind = ref<StudyActivity['kind']>('review')
  const tracker = effect.run(() => useStudyActivity(workspace, kind))!
  expect(begin).not.toHaveBeenCalled()
  busy.value = false
  await Promise.resolve()
  await Promise.resolve()
  expect(begin).toHaveBeenCalledOnce()
  for (let second = 0; second < 3; second++) {
    monotonic += 1000
    await vi.advanceTimersByTimeAsync(1000)
  }
  await tracker.flush()
  expect(record.mock.calls[0]![0][0]).toMatchObject({ kind: 'review', activeMs: 3000 })
  const firstId = record.mock.calls[0]![0][0]!.id
  scope.value = 'b'
  library.value = fixture()
  monotonic += 1000
  await vi.advanceTimersByTimeAsync(1000)
  await tracker.flush()
  expect(record.mock.calls.at(-1)![1]).toBe('b')
  expect(record.mock.calls.at(-1)![0][0]!.id).not.toBe(firstId)
  const calls = record.mock.calls.length
  effect.stop()
  await vi.advanceTimersByTimeAsync(60_000)
  window.dispatchEvent(new Event('blur'))
  expect(record).toHaveBeenCalledTimes(calls)
})

it('does not write statistics on a page-kind change and keeps failed batches for retry', async () => {
  vi.useFakeTimers()
  vi.spyOn(document, 'hasFocus').mockReturnValue(true)
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  let monotonic = 0
  vi.spyOn(performance, 'now').mockImplementation(() => monotonic)
  const library = shallowRef(fixture())
  library.value.studySettings = [
    { ...studySettings(library.value), statisticsSince: new Date().toISOString() },
  ]
  const record = vi.fn().mockRejectedValueOnce(new Error('disk')).mockResolvedValue(undefined)
  const workspace = {
    library,
    scope: ref('a'),
    ready: ref(true),
    busy: ref(false),
    beginStudyStatistics: async () => {},
    recordStudyActivity: record,
  } as unknown as ReturnType<typeof useLibrary>
  const kind = ref<StudyActivity['kind']>('review'),
    effect = effectScope()
  const tracker = effect.run(() => useStudyActivity(workspace, kind))!
  monotonic = 1000
  await vi.advanceTimersByTimeAsync(1000)
  kind.value = 'reading'
  expect(record).not.toHaveBeenCalled()
  await expect(tracker.flush()).rejects.toThrow('disk')
  const failed = record.mock.calls[0]![0]
  await tracker.flush()
  expect(record.mock.calls[1]![0]).toEqual(failed)
  effect.stop()
})

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
async function settle() {
  for (let step = 0; step < 12; step++) await Promise.resolve()
}
function trackingFixture(record: (rows: StudyActivity[], expected: string) => Promise<void>) {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-30T06:00:00Z'))
  vi.spyOn(document, 'hasFocus').mockReturnValue(true)
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  let monotonic = 0
  vi.spyOn(performance, 'now').mockImplementation(() => monotonic)
  const library = shallowRef(fixture())
  library.value.studySettings = [
    { ...studySettings(library.value), statisticsSince: new Date().toISOString() },
  ]
  const scope = ref('a'),
    ready = ref(true),
    kind = ref<StudyActivity['kind']>('review')
  const workspace = {
    library,
    scope,
    ready,
    busy: ref(false),
    beginStudyStatistics: vi.fn(async () => {}),
    recordStudyActivity: record,
  } as unknown as ReturnType<typeof useLibrary>
  const effect = effectScope()
  const tracker = effect.run(() => useStudyActivity(workspace, kind))!
  return {
    tracker,
    effect,
    scope,
    ready,
    kind,
    library,
    async advance() {
      monotonic += 1000
      await vi.advanceTimersByTimeAsync(1000)
    },
  }
}

it('close waits for an in-flight save and persists the final stopped sample', async () => {
  const first = deferred(),
    second = deferred()
  const record = vi
    .fn()
    .mockImplementationOnce(() => first.promise)
    .mockImplementationOnce(() => second.promise)
  const { tracker, effect, advance } = trackingFixture(record)
  await advance()
  const saving = tracker.flush()
  await settle()
  expect(record.mock.calls[0]![0][0].activeMs).toBe(1000)
  await advance()
  let closed = false
  const closing = tracker.close().then(() => {
    closed = true
  })
  await settle()
  expect(record).toHaveBeenCalledTimes(1)
  first.resolve()
  await saving
  await settle()
  expect(record).toHaveBeenCalledTimes(2)
  expect(record.mock.calls[1]![0][0].activeMs).toBe(2000)
  expect(record.mock.calls[1]![0][0].id).toBe(record.mock.calls[0]![0][0].id)
  expect(closed).toBe(false)
  second.resolve()
  await closing
  await advance()
  await tracker.flush()
  expect(record).toHaveBeenCalledTimes(2)
  effect.stop()
})

it('a queued flush saves its captured barrier without following later timer samples', async () => {
  const first = deferred()
  const record = vi
    .fn()
    .mockImplementationOnce(() => first.promise)
    .mockResolvedValue(undefined)
  const { tracker, effect, advance } = trackingFixture(record)
  await advance()
  const saving = tracker.flush()
  await settle()
  await advance()
  const queued = tracker.flush()
  await advance()
  first.resolve()
  await saving
  await queued
  expect(record.mock.calls.map(([rows]) => rows[0].activeMs)).toEqual([1000, 2000])
  await tracker.flush()
  expect(record.mock.calls.at(-1)![0][0].activeMs).toBe(3000)
  effect.stop()
})

it('queued saves retain the original scope and cannot borrow the next library', async () => {
  const first = deferred()
  const record = vi
    .fn()
    .mockImplementationOnce(() => first.promise)
    .mockResolvedValue(undefined)
  const { tracker, effect, advance, scope } = trackingFixture(record)
  await advance()
  const saving = tracker.flush()
  await settle()
  await advance()
  const queued = tracker.flush()
  const rejected = expect(queued).rejects.toThrow('stale-workspace-session')
  scope.value = 'b'
  await advance()
  const nextLibrary = tracker.flush()
  first.resolve()
  await saving
  await rejected
  await nextLibrary
  expect(record.mock.calls).toHaveLength(2)
  expect(record.mock.calls.map(([rows, expected]) => [rows[0].activeMs, expected])).toEqual([
    [1000, 'a'],
    [1000, 'b'],
  ])
  expect(record.mock.calls[1]![0][0].id).not.toBe(record.mock.calls[0]![0][0].id)
  effect.stop()
})

it('isolates plugin listener errors and releases subscriptions created outside the owner scope', async () => {
  const record = vi.fn().mockResolvedValue(undefined)
  const { tracker, effect, advance, kind, library } = trackingFixture(record)
  const error = new Error('plugin callback')
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  const broken = vi.fn(() => {
      throw error
    }),
    healthy = vi.fn()
  const unsubscribe = tracker.subscribe(broken)
  tracker.subscribe(healthy)
  kind.value = 'other'
  expect(healthy).toHaveBeenCalledOnce()
  expect(log).toHaveBeenCalledWith('Study activity listener failed', error)
  library.value = { ...library.value }
  await nextTick()
  expect(healthy).toHaveBeenCalledTimes(2)
  await advance()
  await tracker.close()
  expect(record).toHaveBeenCalledOnce()
  expect(broken).toHaveBeenCalledTimes(2)
  library.value = { ...library.value }
  await nextTick()
  expect(healthy).toHaveBeenCalledTimes(2)
  unsubscribe()
  effect.stop()
})
