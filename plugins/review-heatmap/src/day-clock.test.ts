// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { startDayClock } from './day-clock'
import { localDateKey } from './review-days'

let stop: (() => void) | undefined
afterEach(() => {
  stop?.()
  stop = undefined
  vi.useRealTimers()
  vi.restoreAllMocks()
})

it('refreshes at local midnight with one timer and releases all work after disposal', () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 9, 28, 23, 59, 59, 900))
  const changed = vi.fn()
  const removedWindow = vi.spyOn(window, 'removeEventListener')
  const removedDocument = vi.spyOn(document, 'removeEventListener')
  stop = startDayClock(changed)
  expect(localDateKey(changed.mock.calls[0]![0])).toBe('2026-10-28')
  expect(vi.getTimerCount()).toBe(1)
  vi.advanceTimersByTime(130)
  expect(changed).toHaveBeenCalledTimes(2)
  expect(localDateKey(changed.mock.calls[1]![0])).toBe('2026-10-29')
  expect(vi.getTimerCount()).toBe(1)
  stop()
  stop()
  expect(vi.getTimerCount()).toBe(0)
  expect(removedWindow).toHaveBeenCalledWith('focus', expect.any(Function))
  expect(removedDocument).toHaveBeenCalledWith('visibilitychange', expect.any(Function))
  window.dispatchEvent(new Event('focus'))
  document.dispatchEvent(new Event('visibilitychange'))
  vi.advanceTimersByTime(2 * 86400_000)
  expect(changed).toHaveBeenCalledTimes(2)
})

it('catches up after sleep or visibility restoration without repeating same-day recalculation', () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 9, 28, 10))
  const changed = vi.fn()
  stop = startDayClock(changed)
  window.dispatchEvent(new Event('focus'))
  window.dispatchEvent(new Event('focus'))
  expect(changed).toHaveBeenCalledTimes(1)
  expect(vi.getTimerCount()).toBe(1)
  vi.setSystemTime(new Date(2026, 10, 2, 15))
  window.dispatchEvent(new Event('focus'))
  expect(localDateKey(changed.mock.calls.at(-1)![0])).toBe('2026-11-02')
  expect(changed).toHaveBeenCalledTimes(2)
  vi.setSystemTime(new Date(2026, 10, 3, 11))
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  document.dispatchEvent(new Event('visibilitychange'))
  expect(localDateKey(changed.mock.calls.at(-1)![0])).toBe('2026-11-03')
  expect(changed).toHaveBeenCalledTimes(3)
  expect(vi.getTimerCount()).toBe(1)
})
