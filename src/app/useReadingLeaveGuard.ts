import { onScopeDispose, type Ref } from 'vue'

interface Reader {
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
  onScopeDispose(() => {
    alive = false
  })
  return function beforeLeave(allowBackgroundSave = false): boolean | Promise<boolean> {
    if (!alive) return false
    if (pending) return pending
    const owner = scope.value,
      source = activeSource.value,
      mixed = mixedReader.value
    const owns = () =>
      alive && scope.value === owner && activeSource.value === source && mixedReader.value === mixed
    const readers = [...new Set([source, mixed].filter((reader): reader is Reader => !!reader))]
    // Ordinary navigation can leave an unrelated background save mounted at app level.
    // Replacing the library or closing the window must still wait for that save.
    if (!readers.length && !reading.pending.size) return allowBackgroundSave || !busy.value
    if (busy.value) return false
    pending = (async () => {
      try {
        for (const reader of readers) if (!(await reader.leaveSession()) || !owns()) return false
        await reading.flush()
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
