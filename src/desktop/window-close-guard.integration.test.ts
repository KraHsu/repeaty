// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { clearMocks, mockIPC, mockWindows } from '@tauri-apps/api/mocks'
import { TauriEvent } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { connectWindowCloseGuard } from './window-close-guard'

type EventPayload = { event: string; id: number; payload: null }
type Callback = (event: EventPayload) => unknown
type Listener = { event: string; handler: number; target: { kind: string; label: string } }
const disposers: (() => void)[] = []

afterEach(async () => {
  disposers.splice(0).forEach((stop) => stop())
  // Guard cleanup schedules unlisten; let the real SDK finish its IPC before resetting it.
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  clearMocks()
})

/**
 * Keep the real Window.onCloseRequested/event wrapper. Only the native IPC boundary
 * is modeled: Tauri 2.12.4 manager/window.rs prevents normal close while any native
 * JS listener remains, including callbacks lost by an earlier renderer reload.
 * This is not native-window acceptance testing.
 */
function nativeWindow() {
  const listeners = new Map<number, Listener>()
  const jobs = new Set<Promise<unknown>>()
  const commands: string[] = []
  let closed = false
  let rejectDestroy = false
  const callbacks = () =>
    (
      window as unknown as {
        __TAURI_INTERNALS__: { callbacks: Map<number, Callback> }
      }
    ).__TAURI_INTERNALS__.callbacks

  mockWindows('main')
  mockIPC((command, payload) => {
    commands.push(command)
    const args = payload as Record<string, unknown>
    switch (command) {
      case 'plugin:event|listen': {
        const listener = args as unknown as Listener
        listeners.set(listener.handler, listener)
        return listener.handler
      }
      case 'plugin:event|unlisten':
        listeners.delete(args.eventId as number)
        return
      case 'plugin:window|close': {
        const handlers = [...listeners.entries()].filter(
          ([, listener]) =>
            listener.event === TauriEvent.WINDOW_CLOSE_REQUESTED &&
            ['Window', 'WebviewWindow'].includes(listener.target.kind) &&
            listener.target.label === args.label,
        )
        if (!handlers.length) closed = true
        // Native close is prevented by registrations, not by whether JS still has
        // their callback. IPC acknowledges the request before asynchronous guards finish.
        for (const [id, listener] of handlers) {
          const callback = callbacks().get(listener.handler)
          if (!callback) continue
          const job = Promise.resolve().then(() =>
            callback({ event: listener.event, id, payload: null }),
          )
          jobs.add(job)
          void job.finally(() => jobs.delete(job))
        }
        return
      }
      case 'plugin:window|destroy':
        if (rejectDestroy) {
          rejectDestroy = false
          throw new Error('native destruction failed')
        }
        closed = true
        listeners.clear()
        return
      default:
        throw new Error(`Unexpected native command: ${command}`)
    }
  })

  return {
    commands,
    isClosed: () => closed,
    failNextDestroy: () => {
      rejectDestroy = true
    },
    async leavePreviousPageListener() {
      await getCurrentWindow().onCloseRequested(() => {})
      expect(listeners.size).toBe(1)
      // A renderer reload loses JS callbacks without destroying the native webview.
      callbacks().clear()
    },
    async requestClose() {
      await getCurrentWindow().close()
      while (jobs.size) await Promise.all([...jobs])
    },
  }
}

it('finalizes an approved close despite a native listener left by an earlier page', async () => {
  const native = nativeWindow()
  await native.leavePreviousPageListener()
  const save = vi.fn(async () => true)
  disposers.push(await connectWindowCloseGuard(save))

  await native.requestClose()

  expect(save).toHaveBeenCalledOnce()
  expect(native.isClosed()).toBe(true)
  expect(native.commands.filter((command) => command === 'plugin:window|destroy')).toHaveLength(1)
  expect(native.commands.filter((command) => command === 'plugin:window|close')).toHaveLength(1)
})

it('keeps canceled saves, failed saves and a handled tray action open through the real event wrapper', async () => {
  const native = nativeWindow()
  await native.leavePreviousPageListener()
  const save = vi
    .fn()
    .mockResolvedValueOnce(false)
    .mockRejectedValueOnce(new Error('save failed'))
    .mockResolvedValue(true)
  const afterSave = vi.fn().mockResolvedValueOnce('handled').mockResolvedValue('close')
  disposers.push(await connectWindowCloseGuard(save, { afterSave }))

  await native.requestClose()
  await native.requestClose()
  expect(afterSave).not.toHaveBeenCalled()
  await native.requestClose()
  expect(afterSave).toHaveBeenCalledOnce()
  expect(native.isClosed()).toBe(false)
  expect(native.commands).not.toContain('plugin:window|destroy')

  await native.requestClose()
  expect(native.isClosed()).toBe(true)
  expect(native.commands.filter((command) => command === 'plugin:window|destroy')).toHaveLength(1)
})

it('rechecks saves on retry after native destruction fails without losing the close listener', async () => {
  const native = nativeWindow()
  await native.leavePreviousPageListener()
  const save = vi
    .fn()
    .mockResolvedValueOnce(true)
    .mockResolvedValueOnce(false)
    .mockResolvedValue(true)
  const canceled = vi.fn(async () => {})
  disposers.push(await connectWindowCloseGuard(save, { canceled }))
  native.failNextDestroy()

  await native.requestClose()
  expect(native.isClosed()).toBe(false)
  expect(canceled).toHaveBeenCalledOnce()
  await native.requestClose()
  expect(native.isClosed()).toBe(false)
  expect(native.commands.filter((command) => command === 'plugin:window|destroy')).toHaveLength(1)

  await native.requestClose()
  expect(save).toHaveBeenCalledTimes(3)
  expect(native.isClosed()).toBe(true)
  expect(native.commands.filter((command) => command === 'plugin:window|destroy')).toHaveLength(2)
})
