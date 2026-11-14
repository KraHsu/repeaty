import { expect, it, vi } from 'vitest'
import {
  createSnapRegionController,
  snapRegion,
  type SnapRegionDriver,
  type SnapState,
} from './snap-layout'

const bounds = () => ({ left: 1192, top: 0, width: 44, height: 36 })
function fixture() {
  let position = bounds(),
    event: (state: SnapState) => void = () => {}
  const stop = vi.fn()
  const driver = {
    claim: vi.fn(async (): Promise<number | null> => 7),
    update: vi.fn(async (_epoch: number, _rect: ReturnType<typeof snapRegion>) => true),
    listen: vi.fn(async (handler: (state: SnapState) => void) => {
      event = handler
      return stop
    }),
  } satisfies SnapRegionDriver
  const controller = createSnapRegionController(driver, () => snapRegion(position, 1280, 850))
  return {
    controller,
    driver,
    stop,
    emit: (state: SnapState) => event(state),
    move: (left: number) => {
      position = { ...position, left }
    },
  }
}

it('reports exact CSS coordinates and refuses missing, offscreen or non-finite button regions', () => {
  expect(snapRegion(bounds(), 1280, 850)).toEqual({
    ...bounds(),
    viewportWidth: 1280,
    viewportHeight: 850,
  })
  for (const changed of [
    { left: -1 },
    { top: -1 },
    { width: 0 },
    { height: NaN },
    { left: Infinity },
    { left: 1270 },
  ])
    expect(snapRegion({ ...bounds(), ...changed }, 1280, 850)).toBeNull()
  expect(snapRegion(bounds(), 0, 850)).toBeNull()
})

it('serializes geometry changes and native state belongs only to the current registration', async () => {
  const host = fixture()
  let finish!: (active: boolean) => void
  host.driver.update.mockImplementationOnce(
    () =>
      new Promise((done) => {
        finish = done
      }),
  )
  const start = host.controller.start()
  await vi.waitFor(() => expect(host.driver.update).toHaveBeenCalledTimes(1))
  host.move(1150)
  const changed = host.controller.sync()
  expect(host.driver.update).toHaveBeenCalledTimes(1)
  finish(true)
  await Promise.all([start, changed])
  expect(host.driver.update.mock.calls[1]).toEqual([
    7,
    { ...bounds(), left: 1150, viewportWidth: 1280, viewportHeight: 850 },
  ])
  host.emit({ epoch: 6, hovered: true, pressed: true })
  expect(host.controller.hovered.value).toBe(false)
  host.emit({ epoch: 7, hovered: true, pressed: true })
  expect(host.controller.pressed.value).toBe(true)
  await host.controller.dispose()
  expect(host.driver.update.mock.calls.at(-1)).toEqual([7, null])
  expect(host.stop).toHaveBeenCalledTimes(1)
  expect(host.controller.enabled.value).toBe(false)
})

it('unmount before a delayed claim or listener finishes cannot register a native hit target', async () => {
  const host = fixture()
  let claim!: (value: number | null) => void, listened!: (stop: typeof host.stop) => void
  host.driver.claim.mockImplementation(
    () =>
      new Promise((done) => {
        claim = done
      }),
  )
  host.driver.listen.mockImplementation(
    () =>
      new Promise((done) => {
        listened = done
      }),
  )
  const started = host.controller.start()
  await vi.waitFor(() => expect(host.driver.claim).toHaveBeenCalledTimes(1))
  const closed = host.controller.dispose()
  claim(7)
  listened(host.stop)
  await Promise.all([started, closed])
  expect(host.driver.update).not.toHaveBeenCalled()
  expect(host.stop).toHaveBeenCalledTimes(1)
})

it('hides after an in-flight registration and can recover from an optional native failure', async () => {
  const host = fixture()
  host.driver.update.mockRejectedValueOnce(new Error('Native feature unavailable'))
  await host.controller.start()
  expect(host.controller.enabled.value).toBe(false)
  await host.controller.sync(true)
  expect(host.controller.enabled.value).toBe(true)
  let complete!: (active: boolean) => void
  host.driver.update.mockImplementationOnce(
    () =>
      new Promise((done) => {
        complete = done
      }),
  )
  const changing = host.controller.sync(true)
  await vi.waitFor(() => expect(host.driver.update).toHaveBeenCalledTimes(3))
  const closed = host.controller.dispose()
  complete(true)
  await Promise.all([changing, closed])
  expect(host.driver.update.mock.calls.at(-1)).toEqual([7, null])
  expect(host.controller.enabled.value).toBe(false)
})
