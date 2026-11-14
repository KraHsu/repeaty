import { ref } from 'vue'

type Stop = () => void | Promise<void>
export interface WindowControlsDriver {
  isMaximized(): Promise<boolean>
  isFocused(): Promise<boolean>
  minimize(): Promise<void>
  toggleMaximize(): Promise<void>
  close(): Promise<void>
  onResized(handler: () => void): Promise<Stop>
  onFocusChanged(handler: (event: { payload: boolean }) => void): Promise<Stop>
}

/** Per-window state; native dragging and double-click behavior stay with Tauri. */
export function createWindowControls(driver: WindowControlsDriver) {
  const maximized = ref(false),
    focused = ref(true),
    failed = ref(false)
  let alive = true,
    sizeRead = 0,
    focusRead = 0
  let started: Promise<void> | undefined
  let actions: Promise<void> = Promise.resolve()
  const stops: Stop[] = []
  function stop(listener: Stop) {
    try {
      void Promise.resolve(listener()).catch(() => {})
    } catch {
      /* Already closed. */
    }
  }
  async function listen(register: () => Promise<Stop>) {
    try {
      const listener = await register()
      if (alive) stops.push(listener)
      else stop(listener)
    } catch {
      if (alive) failed.value = true
    }
  }
  async function refreshSize() {
    const read = ++sizeRead
    try {
      const value = await driver.isMaximized()
      if (alive && read === sizeRead) maximized.value = value
    } catch {
      if (alive && read === sizeRead) failed.value = true
    }
  }
  async function refreshFocus() {
    const read = ++focusRead
    try {
      const value = await driver.isFocused()
      if (alive && read === focusRead) focused.value = value
    } catch {
      if (alive && read === focusRead) failed.value = true
    }
  }
  function start() {
    if (!alive) return Promise.resolve()
    return (started ??= Promise.all([
      listen(() =>
        driver.onResized(() => {
          if (alive) void refreshSize()
        }),
      ),
      listen(() =>
        driver.onFocusChanged(({ payload }) => {
          if (alive) {
            focusRead++
            focused.value = payload
          }
        }),
      ),
      refreshSize(),
      refreshFocus(),
    ]).then(() => {}))
  }
  function run(action: 'minimize' | 'toggleMaximize' | 'close') {
    actions = actions.then(async () => {
      if (!alive) return
      failed.value = false
      try {
        // close() follows the OS close-request flow; never force-destroy a window.
        await driver[action]()
        if (alive && action === 'toggleMaximize') await refreshSize()
      } catch {
        if (alive) failed.value = true
      }
    })
    return actions
  }
  function dispose() {
    alive = false
    sizeRead++
    focusRead++
    for (const listener of stops.splice(0)) stop(listener)
  }
  return { maximized, focused, failed, start, run, dispose }
}
