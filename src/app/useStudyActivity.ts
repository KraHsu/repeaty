import { onScopeDispose, watch, type Ref } from 'vue'
import { useEventListener, useIntervalFn } from '@vueuse/core'
import type { useLibrary } from '../composables/useLibrary'
import type { StudyActivity } from '../core/study-data'
import { studySettings } from '../core/study-settings'
import { createStudyActivityRecorder } from '../application/study-activity'

export function useStudyActivity(
  workspace: ReturnType<typeof useLibrary>,
  kind: Readonly<Ref<StudyActivity['kind']>>,
) {
  const recorder = createStudyActivityRecorder()
  const listeners = new Set<() => void>()
  const subscriptions = new Set<() => void>()
  let pending: Promise<void> | undefined
  let disposed = false
  let activityKey = ''
  let sampledScope = ''
  function sample(interacted = false) {
    sampledScope = workspace.ready.value ? workspace.scope.value : ''
    recorder.sample(
      {
        scope: sampledScope,
        wall: new Date(),
        monotonic: performance.now(),
        foreground: document.visibilityState === 'visible' && document.hasFocus(),
        kind: kind.value,
        dayStartHour: studySettings(workspace.library.value).dayStartHour,
      },
      interacted,
    )
    const status = recorder.status(performance.now())
    const key = `${status.foreground}:${status.studying}:${status.idleMs >= 30_000}:${status.idleMs >= 60_000}`
    if (key !== activityKey) {
      activityKey = key
      for (const listener of listeners) listener()
    }
  }
  async function save(expectedScope: string, rows: StudyActivity[]) {
    if (workspace.scope.value !== expectedScope || !workspace.ready.value)
      throw new Error('stale-workspace-session')
    await workspace.beginStudyStatistics(expectedScope)
    if (workspace.scope.value !== expectedScope || !workspace.ready.value)
      throw new Error('stale-workspace-session')
    if (!rows.length) return
    await workspace.recordStudyActivity(rows, expectedScope)
    if (workspace.scope.value === expectedScope) recorder.acknowledge(rows)
  }
  function flush() {
    if (!disposed) sample()
    const expectedScope = sampledScope
    if (!expectedScope) return pending ?? Promise.resolve()
    // Capture a fixed barrier before waiting. A later tick may make a newer row,
    // but this request never follows it indefinitely or borrows another library.
    const rows = recorder.pending()
    const previous = pending
    const next = (previous ?? Promise.resolve())
      .catch(() => {})
      .then(() => save(expectedScope, rows))
    const result = next.finally(() => {
      if (pending === result) pending = undefined
    })
    pending = result
    return result
  }
  const tick = useIntervalFn(() => sample(), 1000)
  const timer = useIntervalFn(() => {
    void flush().catch(() => {})
  }, 30_000)
  const stops = [
    useEventListener(
      window,
      ['pointerdown', 'keydown', 'wheel', 'touchstart'],
      () => sample(true),
      { passive: true },
    ),
    useEventListener(window, ['focus', 'blur'], () => {
      sample()
      void flush().catch(() => {})
    }),
    useEventListener(document, 'visibilitychange', () => {
      sample()
      void flush().catch(() => {})
    }),
    watch(
      [workspace.scope, workspace.ready, workspace.busy],
      () => {
        sample()
        if (
          workspace.ready.value &&
          !workspace.busy.value &&
          !pending &&
          !studySettings(workspace.library.value).statisticsSince
        )
          void flush().catch(() => {})
      },
      { immediate: true, flush: 'sync' },
    ),
    watch(kind, () => sample(), { flush: 'sync' }),
  ]
  function stop() {
    if (disposed) return
    sample()
    disposed = true
    tick.pause()
    timer.pause()
    for (const stop of stops) stop()
    for (const unsubscribe of subscriptions) unsubscribe()
    listeners.clear()
  }
  onScopeDispose(stop)
  return {
    flush,
    async close() {
      stop()
      await flush()
    },
    activity() {
      return recorder.status(performance.now())
    },
    subscribe(listener: () => void) {
      if (disposed) return () => {}
      const notify = () => {
        try {
          listener()
        } catch (error) {
          // One plugin must not interrupt sampling, other listeners, or shutdown.
          console.error('Study activity listener failed', error)
        }
      }
      listeners.add(notify)
      const stop = watch(workspace.library, notify)
      const unsubscribe = () => {
        listeners.delete(notify)
        subscriptions.delete(unsubscribe)
        stop()
      }
      subscriptions.add(unsubscribe)
      return unsubscribe
    },
  }
}
