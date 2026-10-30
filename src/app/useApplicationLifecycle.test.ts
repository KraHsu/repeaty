// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { createApp, h } from 'vue'
import { useApplicationLifecycle } from './useApplicationLifecycle'
import type { useLibrary } from '../composables/useLibrary'
afterEach(() => vi.useRealTimers())
it('cleans listeners, both timers and late-arriving platform subscriptions after unmount', async () => {
  vi.useFakeTimers()
  let reader!: (stop: () => void) => void,
    monitor!: (stop: () => void) => void,
    close!: (stop: () => void) => void
  const workspace = {
    init: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    backupNow: vi.fn(async () => {}),
  } as unknown as ReturnType<typeof useLibrary>
  const stopReader = vi.fn(),
    stopMonitor = vi.fn(),
    stopPlugins = vi.fn(),
    stopPreferences = vi.fn(),
    stopClose = vi.fn(),
    stopWorkspaceGuard = vi.fn(),
    beforeLeave = vi.fn(async () => true)
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
    connectWindowCloseGuard: () =>
      new Promise<() => void>((resolve) => {
        close = resolve
      }),
    connectWorkspaceLeaveGuard: vi.fn(() => stopWorkspaceGuard),
  }
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp({
    setup() {
      useApplicationLifecycle({ workspace, globalKeydown: keydown, tick, beforeLeave }, bindings)
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
  close(stopClose)
  await Promise.resolve()
  expect(stopReader).toHaveBeenCalledTimes(1)
  expect(stopMonitor).toHaveBeenCalledTimes(1)
  expect(stopPlugins).toHaveBeenCalledTimes(1)
  expect(stopPreferences).toHaveBeenCalledTimes(1)
  expect(stopClose).toHaveBeenCalledOnce()
  expect(stopWorkspaceGuard).toHaveBeenCalledOnce()
  expect(bindings.connectWorkspaceLeaveGuard).toHaveBeenCalledWith(beforeLeave)
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b' }))
  await vi.advanceTimersByTimeAsync(60_000)
  expect(keydown).toHaveBeenCalledTimes(1)
  expect(tick).toHaveBeenCalledTimes(6)
  expect(workspace.close).toHaveBeenCalledTimes(1)
  host.remove()
})

it('waits for an old final save and close before initializing a remount of the same store', async () => {
  let finishSave!: () => void, finishClose!: () => void
  const finalSave = new Promise<void>((resolve) => {
    finishSave = resolve
  })
  const finalClose = new Promise<void>((resolve) => {
    finishClose = resolve
  })
  const events: string[] = []
  const workspace = {
    init: vi.fn(async () => {
      events.push('init')
    }),
    close: vi.fn(async () => {
      events.push('close')
      await finalClose
    }),
    backupNow: vi.fn(async () => {}),
  } as unknown as ReturnType<typeof useLibrary>
  const bindings = {
    connectLearningReader: vi.fn(async () => () => {}),
    connectWorkspaceMonitor: vi.fn(async () => () => {}),
    listenPluginPreferences: () => () => {},
    listenPreferences: () => () => {},
  }
  function mount(beforeClose?: () => Promise<void>) {
    const host = document.createElement('div')
    const app = createApp({
      setup() {
        useApplicationLifecycle(
          { workspace: { ...workspace }, globalKeydown: () => {}, tick: () => {}, beforeClose },
          bindings,
        )
        return () => h('div')
      },
    })
    app.mount(host)
    return app
  }
  const first = mount(() => finalSave)
  await vi.waitFor(() => expect(workspace.init).toHaveBeenCalledTimes(1))
  first.unmount()
  const second = mount()
  await Promise.resolve()
  expect(workspace.init).toHaveBeenCalledTimes(1)
  expect(bindings.connectLearningReader).toHaveBeenCalledTimes(1)
  finishSave()
  await vi.waitFor(() => expect(workspace.close).toHaveBeenCalledTimes(1))
  expect(workspace.init).toHaveBeenCalledTimes(1)
  finishClose()
  await vi.waitFor(() => expect(workspace.init).toHaveBeenCalledTimes(2))
  expect(events).toEqual(['init', 'close', 'init'])
  second.unmount()
  await vi.waitFor(() => expect(workspace.close).toHaveBeenCalledTimes(2))
})

it('does not let an older overlapping owner close the current application', async () => {
  const workspace = {
    init: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    backupNow: vi.fn(async () => {}),
  } as unknown as ReturnType<typeof useLibrary>
  const bindings = {
    connectLearningReader: async () => () => {},
    connectWorkspaceMonitor: async () => () => {},
    listenPluginPreferences: () => () => {},
    listenPreferences: () => () => {},
  }
  function mount() {
    const app = createApp({
      setup() {
        useApplicationLifecycle({ workspace, globalKeydown: () => {}, tick: () => {} }, bindings)
        return () => h('div')
      },
    })
    app.mount(document.createElement('div'))
    return app
  }
  const first = mount(),
    second = mount()
  first.unmount()
  await Promise.resolve()
  expect(workspace.close).not.toHaveBeenCalled()
  second.unmount()
  await vi.waitFor(() => expect(workspace.close).toHaveBeenCalledOnce())
})
