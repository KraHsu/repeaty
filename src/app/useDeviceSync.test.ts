// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { createApp, h, ref, shallowRef } from 'vue'
import { useDeviceSync } from './useDeviceSync'
import {
  emptySyncUiState,
  type DeviceSyncController,
  type DeviceSyncOptions,
} from '../sync/controller'
import type { useLibrary } from '../composables/useLibrary'

const apps: { unmount(): void }[] = []
afterEach(() => {
  for (const app of apps.splice(0)) app.unmount()
  document.body.innerHTML = ''
  vi.useRealTimers()
})
const flush = async () => {
  for (let index = 0; index < 12; index++) await Promise.resolve()
}
function workspace() {
  return {
    scope: ref('local:workspace:first'),
    ready: ref(true),
    close: vi.fn(async () => {}),
    applyDeviceSync: vi.fn(async () => {}),
  } as unknown as ReturnType<typeof useLibrary>
}
function service(): DeviceSyncController {
  return {
    state: shallowRef({ ...emptySyncUiState(), available: true }),
    run: vi.fn(async () => {}),
    refresh: vi.fn(async () => {}),
    dispose: vi.fn(async () => {}),
  }
}
function mount(
  reader: ReturnType<typeof useLibrary>,
  factory: (options: DeviceSyncOptions) => Promise<DeviceSyncController>,
) {
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp({
    setup() {
      useDeviceSync(reader, ref(null), undefined, factory)
      return () => h('div')
    },
  })
  app.mount(host)
  apps.push(app)
  return app
}

it('owns status polling at app lifetime and releases it on unmount', async () => {
  vi.useFakeTimers()
  const controller = service(),
    factory = vi.fn(async () => controller)
  const app = mount(workspace(), factory)
  await flush()
  expect(controller.refresh).toHaveBeenCalledOnce()
  await vi.advanceTimersByTimeAsync(3_000)
  expect(controller.refresh).toHaveBeenCalledTimes(2)
  app.unmount()
  apps.splice(apps.indexOf(app), 1)
  await flush()
  await vi.advanceTimersByTimeAsync(9_000)
  expect(controller.refresh).toHaveBeenCalledTimes(2)
  expect(controller.dispose).toHaveBeenCalledOnce()
})

it('awaits disposal before a remount of the same store can own native resources', async () => {
  const reader = workspace(),
    first = service(),
    second = service()
  let finish!: () => void
  first.dispose = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve
      }),
  )
  const firstFactory = vi.fn(async () => first),
    nextFactory = vi.fn(async () => second)
  mount(reader, firstFactory)
  await flush()
  mount(reader, nextFactory)
  await flush()
  expect(first.dispose).toHaveBeenCalledOnce()
  expect(nextFactory).not.toHaveBeenCalled()
  finish()
  await flush()
  expect(nextFactory).toHaveBeenCalledOnce()
  expect(second.refresh).toHaveBeenCalledOnce()
})

it('disposes a factory response that arrives after the workspace has changed', async () => {
  const reader = workspace(),
    old = service(),
    next = service()
  let finish!: (controller: DeviceSyncController) => void
  const seen: DeviceSyncOptions[] = []
  const factory = vi.fn(async (options: DeviceSyncOptions) => {
    seen.push(options)
    if (seen.length === 1)
      return new Promise<DeviceSyncController>((resolve) => {
        finish = resolve
      })
    return next
  })
  mount(reader, factory)
  await flush()
  ;(reader.scope as { value: string }).value = 'local:workspace:second'
  await flush()
  expect(seen[0]!.current()).toBe(false)
  expect(seen).toHaveLength(1)
  finish(old)
  await flush()
  expect(seen[1]!.current()).toBe(true)
  expect(old.dispose).toHaveBeenCalledOnce()
  expect(old.refresh).not.toHaveBeenCalled()
  expect(next.refresh).toHaveBeenCalledOnce()
})

it('serializes a late factory disposal before a new owner of the same workspace starts', async () => {
  const reader = workspace(),
    old = service(),
    next = service()
  let finishFactory!: (value: DeviceSyncController) => void, finishDisposal!: () => void
  old.dispose = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finishDisposal = resolve
      }),
  )
  const firstFactory = vi.fn(
    () =>
      new Promise<DeviceSyncController>((resolve) => {
        finishFactory = resolve
      }),
  )
  const nextFactory = vi.fn(async () => next)
  mount(reader, firstFactory)
  await flush()
  mount(reader, nextFactory)
  await flush()
  expect(nextFactory).not.toHaveBeenCalled()
  finishFactory(old)
  await flush()
  expect(old.dispose).toHaveBeenCalledOnce()
  expect(nextFactory).not.toHaveBeenCalled()
  finishDisposal()
  await flush()
  expect(nextFactory).toHaveBeenCalledOnce()
  expect(next.refresh).toHaveBeenCalledOnce()
})
