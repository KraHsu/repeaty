import { afterEach, expect, it, vi } from 'vitest'
type Listener = (event: { preventDefault(): void }) => void | Promise<void>
const driver = vi.hoisted(() => ({ destroy: vi.fn(), onCloseRequested: vi.fn() }))
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => driver }))
import { connectWindowCloseGuard, windowCloseFailed } from './window-close-guard'

const disposers: (() => void)[] = []
afterEach(async () => {
  disposers.splice(0).forEach((stop) => stop())
  await Promise.resolve()
  vi.resetAllMocks()
})
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
async function setup(
  guard: () => Promise<boolean>,
  options?: Parameters<typeof connectWindowCloseGuard>[1],
) {
  let listener!: Listener
  let subscribed = false
  const unlisten = vi.fn(async () => {
    subscribed = false
  })
  driver.onCloseRequested.mockImplementation(async (value: Listener) => {
    listener = value
    subscribed = true
    return unlisten
  })
  driver.destroy.mockResolvedValue(undefined)
  disposers.push(await connectWindowCloseGuard(guard, options))
  const request = () => {
    const event = { preventDefault: vi.fn() }
    const complete = listener(event)
    return { event, complete }
  }
  return {
    request,
    unlisten,
    detach: () => {
      subscribed = false
    },
    subscribed: () => subscribed,
  }
}
it('prevents immediately, merges repeated requests, then finalizes once after saving', async () => {
  const saving = deferred<boolean>(),
    guard = vi.fn(() => saving.promise)
  const test = await setup(guard)
  const first = test.request(),
    second = test.request(),
    third = test.request()
  for (const request of [first, second, third])
    expect(request.event.preventDefault).toHaveBeenCalledOnce()
  await Promise.resolve()
  expect(guard).toHaveBeenCalledOnce()
  saving.resolve(true)
  await Promise.all([first.complete, second.complete, third.complete])
  expect(driver.destroy).toHaveBeenCalledOnce()
  expect(test.subscribed()).toBe(true)
})
it('keeps false and failed saves open, allowing an explicit later retry', async () => {
  const guard = vi
    .fn()
    .mockResolvedValueOnce(false)
    .mockRejectedValueOnce(new Error('disk'))
    .mockResolvedValue(true)
  const test = await setup(guard)
  await test.request().complete
  await test.request().complete
  expect(driver.destroy).not.toHaveBeenCalled()
  await test.request().complete
  expect(driver.destroy).toHaveBeenCalledOnce()
  expect(test.subscribed()).toBe(true)
})
it('keeps failed finalization guarded, reports the failure and checks a later request again', async () => {
  const guard = vi.fn().mockResolvedValueOnce(true).mockResolvedValue(false)
  const test = await setup(guard)
  driver.destroy.mockRejectedValueOnce(new Error('native close failed'))
  await test.request().complete
  expect(windowCloseFailed.value).toBe(true)
  expect(test.subscribed()).toBe(true)
  const retry = test.request()
  expect(windowCloseFailed.value).toBe(false)
  expect(retry.event.preventDefault).toHaveBeenCalledOnce()
  await retry.complete
  expect(guard).toHaveBeenCalledTimes(2)
  expect(driver.destroy).toHaveBeenCalledOnce()
})
it('does not close after disposal or when a newer session replaces a pending guard', async () => {
  const saving = deferred<boolean>(),
    old = await setup(() => saving.promise)
  const request = old.request()
  await Promise.resolve()
  const next = await setup(async () => false)
  saving.resolve(true)
  await request.complete
  expect(old.unlisten).toHaveBeenCalledOnce()
  expect(driver.destroy).not.toHaveBeenCalled()
  await next.request().complete
  disposers.at(-1)!()
  const stale = next.request()
  expect(stale.event.preventDefault).toHaveBeenCalledOnce()
  await stale.complete
  expect(driver.destroy).not.toHaveBeenCalled()
})
it('releases late registrations without replacing the current session listener', async () => {
  const registered = deferred<() => void>(),
    stopOld = vi.fn(),
    stopNew = vi.fn()
  let oldListener!: Listener
  driver.onCloseRequested
    .mockImplementationOnce((value: Listener) => {
      oldListener = value
      return registered.promise
    })
    .mockResolvedValueOnce(stopNew)
  const old = connectWindowCloseGuard(async () => true)
  const current = await connectWindowCloseGuard(async () => false)
  disposers.push(current)
  registered.resolve(stopOld)
  const stale = await old
  disposers.push(stale)
  expect(stopOld).toHaveBeenCalledOnce()
  expect(stopNew).not.toHaveBeenCalled()
  const event = { preventDefault: vi.fn() }
  await oldListener(event)
  expect(event.preventDefault).toHaveBeenCalledOnce()
  expect(driver.destroy).not.toHaveBeenCalled()
})
it('does not depend on removing the event listener to finalize an approved close', async () => {
  const test = await setup(async () => true)
  test.unlisten.mockRejectedValue(new Error('unlisten failed'))
  await test.request().complete
  expect(test.unlisten).not.toHaveBeenCalled()
  expect(driver.destroy).toHaveBeenCalledOnce()
})
it('does not finalize an old session after its post-save policy resolves late', async () => {
  const policy = deferred<'close' | 'handled'>()
  const started = deferred<void>()
  const test = await setup(async () => true, {
    afterSave: () => {
      started.resolve()
      return policy.promise
    },
  })
  const request = test.request()
  await started.promise
  await setup(async () => false)
  policy.resolve('close')
  await request.complete
  expect(driver.destroy).not.toHaveBeenCalled()
})

it('retains the save listener when a post-save native action hides the window', async () => {
  const afterSave = vi.fn().mockResolvedValueOnce('handled').mockResolvedValue('close')
  const test = await setup(async () => true, { afterSave })
  await test.request().complete
  expect(driver.destroy).not.toHaveBeenCalled()
  expect(test.subscribed()).toBe(true)
  await test.request().complete
  expect(driver.destroy).toHaveBeenCalledOnce()
})
it('does not hide or install after a rejected save and cancels pending quit intent', async () => {
  const afterSave = vi.fn(),
    canceled = vi.fn(async () => {})
  const test = await setup(async () => false, { afterSave, canceled })
  await test.request().complete
  expect(afterSave).not.toHaveBeenCalled()
  expect(canceled).toHaveBeenCalledOnce()
  expect(driver.destroy).not.toHaveBeenCalled()
})
it('native post-save failure leaves the existing close guard attached', async () => {
  const afterSave = vi.fn(async () => {
      throw new Error('native failed')
    }),
    canceled = vi.fn(async () => {})
  const test = await setup(async () => true, { afterSave, canceled })
  await test.request().complete
  expect(canceled).toHaveBeenCalledOnce()
  expect(test.subscribed()).toBe(true)
  expect(driver.destroy).not.toHaveBeenCalled()
})
