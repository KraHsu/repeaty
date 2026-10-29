import { nextTick, onScopeDispose, watch, type Ref } from 'vue'

interface Reader {
  readonly locked?: boolean
  leaveSession(): Promise<boolean>
}

/** Await the mounted readers before anything can retire their editor or library. */
export function useReadingLeaveGuard({
  scope,
  busy,
  activeSource,
  mixedReader,
  reading,
}: {
  scope: Readonly<Ref<string>>
  busy: Readonly<Ref<boolean>>
  activeSource: Readonly<Ref<Reader | undefined>>
  mixedReader: Readonly<Ref<Reader | undefined>>
  reading: { pending: ReadonlyMap<string, unknown>; flush(): Promise<void> }
}) {
  let alive = true,
    pending: Promise<boolean> | undefined
  const waits = new Set<() => void>()
  onScopeDispose(() => {
    alive = false
    for (const cancel of waits) cancel()
  })
  function waitForIdle(owns: () => boolean, blocked: () => boolean): Promise<boolean> {
    return new Promise((resolve) => {
      let stop = () => {}
      const finish = (allowed: boolean) => {
        stop()
        waits.delete(cancel)
        resolve(allowed)
      }
      const cancel = () => finish(false)
      const check = () => {
        if (!owns()) finish(false)
        else if (!blocked()) finish(true)
      }
      waits.add(cancel)
      stop = watch([blocked, scope, activeSource, mixedReader], check, { flush: 'sync' })
      check()
    })
  }
  return function beforeLeave(allowBackgroundSave = false): boolean | Promise<boolean> {
    if (!alive) return false
    if (pending) return pending
    const owner = scope.value,
      source = activeSource.value,
      mixed = mixedReader.value
    const owns = () =>
      alive && scope.value === owner && activeSource.value === source && mixedReader.value === mixed
    const readers = [...new Set([source, mixed].filter((reader): reader is Reader => !!reader))]
    const blocked = () => busy.value || readers.some((reader) => reader.locked)
    // Ordinary navigation can leave an unrelated background save mounted at app level.
    // Replacing the library or closing the window must still wait for that save.
    if (!readers.length && !reading.pending.size && (allowBackgroundSave || !busy.value))
      return true
    const idle = async () => {
      while (blocked() && owns()) {
        if (!(await waitForIdle(owns, blocked))) return false
        // The reader receives busy as a prop; let it observe the completed save too.
        await nextTick()
      }
      return owns()
    }
    pending = (async () => {
      try {
        if (blocked() && !(await idle())) return false
        for (const reader of readers) {
          if (!owns() || !(await reader.leaveSession()) || !owns()) return false
          if (blocked() && !(await idle())) return false
        }
        await reading.flush()
        if (blocked() && !(await idle())) return false
        return owns() && !busy.value && reading.pending.size === 0
      } catch {
        // The editor/reading owner keeps its error and draft visible for another attempt.
        return false
      } finally {
        pending = undefined
      }
    })()
    return pending
  }
}
