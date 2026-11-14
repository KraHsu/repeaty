import { ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import type { Window } from '@tauri-apps/api/window'

export interface SnapRegion {
  left: number
  top: number
  width: number
  height: number
  viewportWidth: number
  viewportHeight: number
}
export interface SnapState {
  epoch: number
  hovered: boolean
  pressed: boolean
}
type Stop = () => void | Promise<void>
export interface SnapRegionDriver {
  claim(): Promise<number | null>
  update(epoch: number, rect: SnapRegion | null): Promise<boolean>
  listen(handler: (state: SnapState) => void): Promise<Stop>
}

// Keep normal component replacement/HMR registrations ordered in this renderer.
let nativeRequests: Promise<unknown> = Promise.resolve()
function nativeCall<T>(command: string, args?: Record<string, unknown>) {
  const request = nativeRequests.then(() => invoke<T>(command, args))
  nativeRequests = request.catch(() => {})
  return request
}
export function nativeSnapDriver(window: Pick<Window, 'listen'>): SnapRegionDriver {
  return {
    claim: () => nativeCall<number | null>('window_snap_epoch'),
    update: (epoch, rect) => nativeCall<boolean>('window_snap_region', { epoch, rect }),
    listen: (handler) =>
      window.listen<SnapState>('window-snap-state', ({ payload }) => handler(payload)),
  }
}

/** CSS coordinates stay unscaled; the native client size accounts for DPI and WebView zoom. */
export function snapRegion(
  bounds: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
  viewportWidth: number,
  viewportHeight: number,
): SnapRegion | null {
  const rect = {
    left: bounds.left,
    top: bounds.top,
    width: bounds.width,
    height: bounds.height,
    viewportWidth,
    viewportHeight,
  }
  if (Object.values(rect).some((value) => !Number.isFinite(value))) return null
  if (
    viewportWidth <= 0 ||
    viewportHeight <= 0 ||
    bounds.width <= 0 ||
    bounds.height <= 0 ||
    bounds.left < 0 ||
    bounds.top < 0
  )
    return null
  if (
    bounds.left + bounds.width > viewportWidth + 0.5 ||
    bounds.top + bounds.height > viewportHeight + 0.5
  )
    return null
  return rect
}

/** A native registration is owned by this titlebar, including delayed initialization and teardown. */
export function createSnapRegionController(
  driver: SnapRegionDriver,
  measure: () => SnapRegion | null,
) {
  const enabled = ref(false),
    hovered = ref(false),
    pressed = ref(false)
  let alive = true,
    revision = 0
  let queue: Promise<void> = Promise.resolve(),
    started: Promise<void> | undefined
  let claim: Promise<number | null> | undefined,
    epoch: number | null = null
  let lastSent: string | undefined,
    listener: Stop | undefined,
    registrationSent = false
  const reset = () => {
    enabled.value = false
    hovered.value = false
    pressed.value = false
  }
  function stop(value: Stop) {
    try {
      void Promise.resolve(value()).catch(() => {})
    } catch {
      /* The native window may already be closed. */
    }
  }
  function getEpoch() {
    return (claim ??= driver
      .claim()
      .then((value) => {
        epoch = value
        return value
      })
      .catch((error: unknown) => {
        claim = undefined
        throw error
      }))
  }
  function submit(rect: SnapRegion | null, force: boolean) {
    const generation = ++revision,
      key = JSON.stringify(rect)
    queue = queue.then(async () => {
      if (!alive || generation !== revision || (!force && key === lastSent)) return
      try {
        const value = await getEpoch()
        if (!alive || generation !== revision || value === null) return
        registrationSent = true
        const active = await driver.update(value, rect)
        lastSent = key
        if (alive && generation === revision) {
          enabled.value = active && rect !== null
          if (!enabled.value) {
            hovered.value = false
            pressed.value = false
          }
        }
      } catch {
        lastSent = undefined
        if (alive && generation === revision) reset()
      }
    })
    return queue
  }
  const sync = (force = false) => (alive ? submit(measure(), force) : Promise.resolve())
  function clear() {
    return alive ? submit(null, true) : Promise.resolve()
  }
  function start() {
    if (!alive) return Promise.resolve()
    return (started ??= Promise.all([
      driver
        .listen((state) => {
          if (!alive || state.epoch !== epoch || !enabled.value) return
          hovered.value = state.hovered === true
          pressed.value = state.pressed === true
        })
        .then((stop) => {
          if (alive) listener = stop
          else void Promise.resolve(stop()).catch(() => {})
        })
        .catch(() => {}),
      sync(true),
    ]).then(() => {}))
  }
  function dispose() {
    if (!alive) return queue
    alive = false
    revision++
    reset()
    if (listener) stop(listener)
    // Always run after any in-flight registration. The epoch prevents a previous
    // page or HMR instance from clearing a newer titlebar's native hit target.
    const ownedClaim = registrationSent ? claim : undefined
    queue = queue.then(async () => {
      try {
        const value = await ownedClaim
        if (value !== undefined && value !== null) await driver.update(value, null)
      } catch {
        /* Ordinary HTML controls remain available when native Snap cannot initialize. */
      }
    })
    return queue
  }
  return { enabled, hovered, pressed, start, sync, clear, dispose }
}
