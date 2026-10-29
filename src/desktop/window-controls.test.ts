import { expect, it, vi } from 'vitest'
import { createWindowControls, type WindowControlsDriver } from './window-controls'

function fixture() {
  let maximized = false
  let resized: () => void = () => {},
    focusChanged: (event: { payload: boolean }) => void = () => {}
  const stopResize = vi.fn(),
    stopFocus = vi.fn()
  const driver = {
    isMaximized: vi.fn(async () => maximized),
    isFocused: vi.fn(async () => true),
    minimize: vi.fn(async () => {}),
    toggleMaximize: vi.fn(async () => {
      maximized = !maximized
    }),
    close: vi.fn(async () => {}),
    onResized: vi.fn(async (handler: () => void) => {
      resized = handler
      return stopResize
    }),
    onFocusChanged: vi.fn(async (handler: (event: { payload: boolean }) => void) => {
      focusChanged = handler
      return stopFocus
    }),
  } satisfies WindowControlsDriver
  return {
    driver,
    stopResize,
    stopFocus,
    resized: () => resized(),
    focus: (payload: boolean) => focusChanged({ payload }),
  }
}
it('tracks native resize/focus events and closes through the normal window request', async () => {
  const host = fixture(),
    controls = createWindowControls(host.driver)
  await controls.start()
  await controls.start()
  expect(host.driver.onResized).toHaveBeenCalledTimes(1)
  await controls.run('toggleMaximize')
  expect(controls.maximized.value).toBe(true)
  await host.driver.toggleMaximize()
  host.resized()
  await vi.waitFor(() => expect(controls.maximized.value).toBe(false))
  host.focus(false)
  expect(controls.focused.value).toBe(false)
  await controls.run('minimize')
  await controls.run('close')
  expect(host.driver.minimize).toHaveBeenCalledTimes(1)
  expect(host.driver.close).toHaveBeenCalledTimes(1)
  controls.dispose()
  expect(host.stopResize).toHaveBeenCalledTimes(1)
  expect(host.stopFocus).toHaveBeenCalledTimes(1)
})
it('ignores old state reads and releases listeners that arrive after disposal', async () => {
  const host = fixture()
  let finishResize!: (stop: typeof host.stopResize) => void, finishFocus!: (value: boolean) => void
  host.driver.onResized.mockImplementation(
    () =>
      new Promise((done) => {
        finishResize = done
      }),
  )
  host.driver.isFocused.mockImplementation(
    () =>
      new Promise((done) => {
        finishFocus = done
      }),
  )
  const controls = createWindowControls(host.driver)
  const started = controls.start()
  host.focus(false)
  finishFocus(true)
  await Promise.resolve()
  expect(controls.focused.value).toBe(false)
  controls.dispose()
  finishResize(host.stopResize)
  await started
  expect(host.stopResize).toHaveBeenCalledTimes(1)
  expect(host.stopFocus).toHaveBeenCalledTimes(1)
  await controls.run('close')
  expect(host.driver.close).not.toHaveBeenCalled()
})
it('keeps controls usable after a native failure and isolates simultaneous windows', async () => {
  const host = fixture(),
    controls = createWindowControls(host.driver)
  const other = createWindowControls(fixture().driver)
  host.driver.minimize.mockRejectedValueOnce(new Error('Native failure'))
  await controls.start()
  await controls.run('minimize')
  expect(controls.failed.value).toBe(true)
  expect(other.failed.value).toBe(false)
  await controls.run('toggleMaximize')
  expect(controls.failed.value).toBe(false)
  expect(controls.maximized.value).toBe(true)
  expect(other.maximized.value).toBe(false)
  controls.dispose()
  other.dispose()
})
it('does not replace a newer native resize state with an older pending query', async () => {
  const host = fixture()
  let first!: (value: boolean) => void
  host.driver.isMaximized.mockImplementationOnce(
    () =>
      new Promise((done) => {
        first = done
      }),
  )
  host.driver.isMaximized.mockResolvedValueOnce(true)
  const controls = createWindowControls(host.driver),
    started = controls.start()
  host.resized()
  await vi.waitFor(() => expect(controls.maximized.value).toBe(true))
  first(false)
  await started
  expect(controls.maximized.value).toBe(true)
  controls.dispose()
})
