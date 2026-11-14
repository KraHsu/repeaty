import { getCurrentWindow } from '@tauri-apps/api/window'
import { ref } from 'vue'

type CloseEvent = { preventDefault(): void }
type Stop = () => void | Promise<void>
let active: { stop(): void } | undefined
export const windowCloseFailed = ref(false)

/** One owner per application window. Never bypass another session's pending save. */
export async function connectWindowCloseGuard(
  beforeClose: () => boolean | Promise<boolean>,
  options?: {
    afterSave?(): Promise<'close' | 'handled'>
    canceled?(): Promise<void>
  },
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
  windowCloseFailed.value = false
  const current = () => alive && active === owner
  async function install() {
    const stop = await window.onCloseRequested(requested)
    if (!current()) await stop()
    else subscriptions.add(stop)
  }
  const requested = (event: CloseEvent): void | Promise<void> => {
    // This must happen synchronously, before awaiting editor or repository work.
    event.preventDefault()
    if (!current()) return
    if (pending) return pending
    windowCloseFailed.value = false
    pending = Promise.resolve()
      .then(async () => {
        try {
          if (!current()) return
          if (!(await beforeClose()) || !current()) {
            await options?.canceled?.()
            return
          }
          if ((await options?.afterSave?.()) === 'handled' || !current()) return
          // Finalize only after this owner's save and tray/update policy have approved.
          // A second close() can be prevented by stale native JS listeners left after
          // a renderer reload. This is the same final operation used by Tauri's
          // onCloseRequested, while keeping our guard attached until it succeeds.
          await window.destroy()
        } catch {
          if (current()) windowCloseFailed.value = true
          await options?.canceled?.().catch(() => {})
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
    if (current()) windowCloseFailed.value = true
    owner.stop()
    throw error
  }
  return owner.stop
}
