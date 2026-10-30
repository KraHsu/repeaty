import { afterEach, expect, it, vi } from 'vitest'
import { scheduleStartup } from './startup'

afterEach(() => vi.useRealTimers())

function controller() {
  return {
    state: { value: undefined as unknown },
    error: { value: new Error('study-service-unavailable') as unknown },
    start: vi.fn(async () => {}),
  }
}

it('waits for publication and keeps retrying slow workspace hydration until ready', async () => {
  vi.useFakeTimers()
  const value = controller()
  const cancel = scheduleStartup(value)
  expect(value.start).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(0)
  expect(value.start).toHaveBeenCalledTimes(1)
  value.error.value = new Error('stale-workspace-session')
  await vi.advanceTimersByTimeAsync(90_000)
  expect(value.start.mock.calls.length).toBeGreaterThan(8)
  value.start.mockImplementation(async () => {
    value.state.value = { workspaceScope: 'ready' }
  })
  await vi.advanceTimersByTimeAsync(30_000)
  expect(vi.getTimerCount()).toBe(0)
  const calls = value.start.mock.calls.length
  await vi.advanceTimersByTimeAsync(90_000)
  expect(value.start).toHaveBeenCalledTimes(calls)
  cancel()
})

it('stops on a real failure instead of hiding it in retries', async () => {
  vi.useFakeTimers()
  const value = controller()
  value.error.value = new Error('invalid-library')
  scheduleStartup(value)
  await vi.advanceTimersByTimeAsync(90_000)
  expect(value.start).toHaveBeenCalledTimes(1)
  expect(vi.getTimerCount()).toBe(0)
})

it('cancels before publication or during pending hydration', async () => {
  vi.useFakeTimers()
  const value = controller()
  scheduleStartup(value)()
  await vi.advanceTimersByTimeAsync(0)
  expect(value.start).not.toHaveBeenCalled()
  let finish!: () => void
  value.start.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve
      }),
  )
  const cancel = scheduleStartup(value)
  await vi.advanceTimersByTimeAsync(0)
  cancel()
  finish()
  await vi.advanceTimersByTimeAsync(90_000)
  expect(value.start).toHaveBeenCalledTimes(1)
  expect(vi.getTimerCount()).toBe(0)
})
