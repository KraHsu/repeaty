import { getCurrentWindow } from '@tauri-apps/api/window'

type CloseEvent = { preventDefault(): void }
type Stop = () => void | Promise<void>
let active: { stop(): void } | undefined

/** One owner per application window. Never bypass another session's pending save. */
export async function connectWindowCloseGuard(
  beforeClose: () => boolean | Promise<boolean>,
): Promise<() => void> {
  active?.stop()
  const window = getCurrentWindow()
  let alive = true
  const subscriptions = new Set<Stop>()
  let pending: Promise<void> | undefined
  const owner = {
    stop() {
      if (!alive) return
      alive = false
      for (const stop of subscriptions)
        void Promise.resolve()
          .then(stop)
          .catch(() => {})
      subscriptions.clear()
      if (active === owner) active = undefined
    },
  }
  active = owner
  const current = () => alive && active === owner
  async function install() {
    const stop = await window.onCloseRequested(requested)
    if (!current()) await stop()
    else subscriptions.add(stop)
  }
  async function disconnect() {
    for (const stop of subscriptions) {
      await stop()
      subscriptions.delete(stop)
    }
  }
  const requested = (event: CloseEvent): void | Promise<void> => {
    // This must happen synchronously, before awaiting editor or repository work.
    event.preventDefault()
    if (!current()) return
    if (pending) return pending
    pending = Promise.resolve()
      .then(async () => {
        let releasing = false
        try {
          if (!current() || !(await beforeClose()) || !current()) return
          releasing = true
          // Tauri's onCloseRequested calls destroy() when an event is not prevented.
          // Remove only our listeners, then request the existing native close path.
          await disconnect()
          if (!current()) return
          await window.close()
        } catch {
          // An uncertain unlisten outcome retains its cleanup handle. Rebinding is
          // safe: simultaneous callbacks still share this single pending promise.
          if (current() && releasing) {
            try {
              await install()
            } catch {
              /* The native window may already be gone. */
            }
          }
        }
      })
      .finally(() => {
        pending = undefined
      })
    return pending
  }
  try {
    await install()
  } catch (error) {
    owner.stop()
    throw error
  }
  return owner.stop
}
