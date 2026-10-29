// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { createApp, h } from 'vue'
import { useApplicationLifecycle } from './useApplicationLifecycle'
import type { useLibrary } from '../composables/useLibrary'
afterEach(() => vi.useRealTimers())
it('cleans listeners, both timers and late-arriving platform subscriptions after unmount', async () => {
  vi.useFakeTimers()
  let reader!: (stop: () => void) => void, monitor!: (stop: () => void) => void
  const workspace = {
    init: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    backupNow: vi.fn(async () => {}),
  } as unknown as ReturnType<typeof useLibrary>
  const stopReader = vi.fn(),
    stopMonitor = vi.fn(),
    stopPlugins = vi.fn(),
    stopPreferences = vi.fn()
  const keydown = vi.fn(),
    tick = vi.fn()
  const bindings = {
    connectLearningReader: () =>
      new Promise<() => void>((resolve) => {
        reader = resolve
      }),
    connectWorkspaceMonitor: () =>
      new Promise<() => void>((resolve) => {
        monitor = resolve
      }),
    listenPluginPreferences: () => stopPlugins,
    listenPreferences: () => stopPreferences,
  }
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp({
    setup() {
      useApplicationLifecycle({ workspace, globalKeydown: keydown, tick }, bindings)
      return () => h('div')
    },
  })
  app.mount(host)
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b' }))
  expect(keydown).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(60_000)
  expect(tick).toHaveBeenCalledTimes(6)
  expect(workspace.backupNow).toHaveBeenCalledTimes(1)
  app.unmount()
  reader(stopReader)
  monitor(stopMonitor)
  await Promise.resolve()
  expect(stopReader).toHaveBeenCalledTimes(1)
  expect(stopMonitor).toHaveBeenCalledTimes(1)
  expect(stopPlugins).toHaveBeenCalledTimes(1)
  expect(stopPreferences).toHaveBeenCalledTimes(1)
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b' }))
  await vi.advanceTimersByTimeAsync(60_000)
  expect(keydown).toHaveBeenCalledTimes(1)
  expect(tick).toHaveBeenCalledTimes(6)
  expect(workspace.close).toHaveBeenCalledTimes(1)
  host.remove()
})
