import { onMounted, onUnmounted } from 'vue'
import { connectLearningReader, connectWorkspaceMonitor } from '@repeaty-platform'
import { listenPluginPreferences } from '../plugins'
import { listenPreferences } from '../preferences'
import type { useLibrary } from '../composables/useLibrary'

const defaults = {
  connectLearningReader,
  connectWorkspaceMonitor,
  listenPluginPreferences,
  listenPreferences,
}
export function useApplicationLifecycle(
  {
    workspace,
    globalKeydown,
    tick,
  }: {
    workspace: ReturnType<typeof useLibrary>
    globalKeydown: (event: KeyboardEvent) => void
    tick: () => void
  },
  bindings = defaults,
) {
  let alive = true
  const stops: (() => void)[] = []
  let clockTimer: ReturnType<typeof setInterval> | undefined
  let backupTimer: ReturnType<typeof setInterval> | undefined
  function own(stop: () => void) {
    if (alive) stops.push(stop)
    else stop()
  }
  onMounted(() => {
    window.addEventListener('keydown', globalKeydown)
    own(bindings.listenPluginPreferences())
    own(bindings.listenPreferences())
    void bindings.connectLearningReader(workspace).then(own)
    void bindings.connectWorkspaceMonitor(workspace).then(own)
    void workspace.init()
    backupTimer = setInterval(() => {
      void workspace.backupNow()
    }, 60_000)
    clockTimer = setInterval(tick, 10_000)
  })
  onUnmounted(() => {
    alive = false
    window.removeEventListener('keydown', globalKeydown)
    for (const stop of stops.splice(0)) stop()
    clearInterval(backupTimer)
    clearInterval(clockTimer)
    void workspace.close()
  })
}
