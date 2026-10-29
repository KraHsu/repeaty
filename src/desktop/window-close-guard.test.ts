import { afterEach, expect, it, vi } from 'vitest'
type Listener = (event: { preventDefault(): void }) => void | Promise<void>
const driver = vi.hoisted(() => ({ close: vi.fn(), onCloseRequested: vi.fn() }))
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => driver }))
import { connectWindowCloseGuard } from './window-close-guard'

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
async function setup(guard: () => Promise<boolean>) {
  let listener!: Listener
  let subscribed = false
  const unlisten = vi.fn(async () => {
      subscribed = false
    }),
    permitted: boolean[] = []
  driver.onCloseRequested.mockImplementation(async (value: Listener) => {
    listener = value
    subscribed = true
    return unlisten
  })
  driver.close.mockImplementation(async () => {
    const event = { preventDefault: vi.fn() }
    if (subscribed) await listener(event)
    permitted.push(!event.preventDefault.mock.calls.length)
  })
  disposers.push(await connectWindowCloseGuard(guard))
  const request = () => {
    const event = { preventDefault: vi.fn() }
    const complete = listener(event)
    return { event, complete }
  }
  return {
    request,
    unlisten,
    permitted,
    detach: () => {
      subscribed = false
    },
    subscribed: () => subscribed,
  }
}
it('prevents immediately, merges repeated requests, then allows one normal close event', async () => {
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
  expect(driver.close).toHaveBeenCalledOnce()
  expect(test.permitted).toEqual([true])
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
  expect(driver.close).not.toHaveBeenCalled()
  await test.request().complete
  expect(driver.close).toHaveBeenCalledOnce()
  expect(test.permitted).toEqual([true])
})
it('revokes a failed native close allowance before processing another request', async () => {
  const guard = vi.fn().mockResolvedValueOnce(true).mockResolvedValue(false)
  const test = await setup(guard)
  driver.close.mockRejectedValueOnce(new Error('native close failed'))
  await test.request().complete
  const retry = test.request()
  expect(retry.event.preventDefault).toHaveBeenCalledOnce()
  await retry.complete
  expect(guard).toHaveBeenCalledTimes(2)
  expect(driver.close).toHaveBeenCalledOnce()
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
  expect(driver.close).not.toHaveBeenCalled()
  await next.request().complete
  disposers.at(-1)!()
  const stale = next.request()
  expect(stale.event.preventDefault).toHaveBeenCalledOnce()
  await stale.complete
  expect(driver.close).not.toHaveBeenCalled()
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
  expect(driver.close).not.toHaveBeenCalled()
})
it('does not issue close after failed unlisten and safely restores request handling', async () => {
  const guard = vi.fn(async () => true),
    test = await setup(guard)
  test.unlisten.mockImplementationOnce(async () => {
    test.detach()
    throw new Error('unlisten failed after removing listener')
  })
  await test.request().complete
  expect(driver.close).not.toHaveBeenCalled()
  expect(driver.onCloseRequested).toHaveBeenCalledTimes(2)
  expect(test.subscribed()).toBe(true)
  await test.request().complete
  expect(driver.close).toHaveBeenCalledOnce()
  expect(test.permitted).toEqual([true])
})
it('does not close a new session when releasing an old listener completes late', async () => {
  const release = deferred<void>(),
    test = await setup(async () => true)
  test.unlisten.mockImplementationOnce(() => release.promise)
  const request = test.request()
  await Promise.resolve()
  await Promise.resolve()
  await setup(async () => false)
  release.resolve()
  await request.complete
  expect(driver.close).not.toHaveBeenCalled()
})
