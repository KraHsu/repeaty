import { createPinia } from 'pinia'
import { effectScope, ref } from 'vue'
import { afterEach, expect, it, vi } from 'vitest'
import { useReadingLeaveGuard } from './useReadingLeaveGuard'
import { useAppNavigation } from './useAppNavigation'
import { fixture } from '../core/test-fixtures'

const scopes: ReturnType<typeof effectScope>[] = []
afterEach(() => {
  for (const scope of scopes.splice(0)) scope.stop()
})
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
function setup() {
  const lifetime = effectScope()
  scopes.push(lifetime)
  const scope = ref('library:one'),
    busy = ref(false),
    activeSource = ref<{ leaveSession(): Promise<boolean> }>(),
    mixedReader = ref<{ leaveSession(): Promise<boolean> }>(),
    reading = { pending: new Map<string, unknown>(), flush: vi.fn(async () => {}) }
  const beforeLeave = lifetime.run(() =>
    useReadingLeaveGuard({ scope, busy, activeSource, mixedReader, reading }),
  )!
  const navigation = lifetime.run(() => useAppNavigation(createPinia(), () => beforeLeave(true)))!
  navigation.tab.value = 'sources'
  return { lifetime, scope, busy, activeSource, mixedReader, reading, beforeLeave, navigation }
}

it('allows unrelated page navigation during background metadata saves but keeps close and workspace changes guarded', async () => {
  const test = setup()
  test.busy.value = true
  expect(test.beforeLeave()).toBe(false)
  expect(test.navigation.navigate('cards')).toBe(true)
  expect(test.navigation.tab.value).toBe('cards')
  test.activeSource.value = { leaveSession: vi.fn(async () => true) }
  expect(test.navigation.navigate('workspace')).toBe(false)
  expect(test.navigation.tab.value).toBe('cards')
})

it('awaits main reader drafts before navigating and keeps the page when draft or annotation refuses leaving', async () => {
  const test = setup(),
    pending = deferred<boolean>(),
    leave = vi.fn(() => pending.promise)
  test.activeSource.value = { leaveSession: leave }
  const changing = test.navigation.navigate('workspace')
  expect(test.navigation.tab.value).toBe('sources')
  expect(leave).toHaveBeenCalledOnce()
  pending.resolve(false)
  expect(await changing).toBe(false)
  expect(test.navigation.tab.value).toBe('sources')
  expect(test.reading.flush).not.toHaveBeenCalled()
  leave.mockResolvedValue(true)
  expect(await test.navigation.navigate('workspace')).toBe(true)
  expect(test.navigation.tab.value).toBe('workspace')
  expect(test.reading.flush).toHaveBeenCalledOnce()
})

it('runs every navigation entry and review transition through the same guard', async () => {
  const test = setup(),
    leave = vi.fn(async () => false),
    after = vi.fn()
  test.activeSource.value = { leaveSession: leave }
  const transitions = [
    () => test.navigation.navigate('cards', after),
    () => test.navigation.openPluginPage('plugin', 'page'),
    () => test.navigation.startReading(),
    () => test.navigation.openHistory(),
    () => test.navigation.openDeck(fixture().decks[0]!),
    () => test.navigation.transition(after),
  ]
  for (const transition of transitions) expect(await transition()).toBe(false)
  expect(test.navigation.tab.value).toBe('sources')
  expect(test.navigation.autoStartReading.value).toBe(false)
  expect(test.navigation.pluginPage.value).toBeUndefined()
  expect(test.navigation.selectedDeck.value).toBe('')
  expect(after).not.toHaveBeenCalled()
  leave.mockResolvedValue(true)
  expect(await test.navigation.navigate('cards', after)).toBe(true)
  expect(after).toHaveBeenCalledOnce()
})

it('flushes mixed reading and pending positions, and never authorizes a failed reading save', async () => {
  const test = setup(),
    leave = vi.fn(async () => true)
  test.mixedReader.value = { leaveSession: leave }
  test.reading.pending.set('material', {})
  expect(await test.beforeLeave()).toBe(false)
  expect(leave).toHaveBeenCalledOnce()
  test.reading.flush.mockImplementation(async () => {
    test.reading.pending.clear()
  })
  expect(await test.beforeLeave()).toBe(true)
  test.busy.value = true
  expect(await test.beforeLeave()).toBe(false)
})

it('coalesces pending flushes, uses the latest navigation target and rejects scope or view replacements', async () => {
  const test = setup(),
    pending = deferred<boolean>(),
    leave = vi.fn(() => pending.promise)
  test.activeSource.value = { leaveSession: leave }
  const first = test.navigation.navigate('cards'),
    second = test.navigation.navigate('settings')
  expect(leave).toHaveBeenCalledOnce()
  pending.resolve(true)
  expect(await first).toBe(false)
  expect(await second).toBe(true)
  expect(test.navigation.tab.value).toBe('settings')

  for (const replace of [
    () => {
      test.scope.value = 'library:two'
      test.navigation.resetLibrary()
    },
    () => {
      test.activeSource.value = { leaveSession: vi.fn(async () => true) }
    },
    () => {
      test.lifetime.stop()
    },
  ]) {
    const late = deferred<boolean>()
    test.activeSource.value = { leaveSession: () => late.promise }
    const changing = test.navigation.navigate('workspace')
    replace()
    late.resolve(true)
    expect(await changing).toBe(false)
    expect(test.navigation.tab.value).toBe('settings')
  }
})
