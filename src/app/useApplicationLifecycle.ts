import { onMounted, onUnmounted } from 'vue'
import { useEventListener, useIntervalFn } from '@vueuse/core'
import { connectLearningReader, connectWorkspaceMonitor } from '@repeaty-platform'
import { listenPluginPreferences } from '../plugins'
import { listenPreferences } from '../preferences'
import type { PluginManager } from '../plugins/manager'
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
    plugins,
  }: {
    workspace: ReturnType<typeof useLibrary>
    globalKeydown: (event: KeyboardEvent) => void
    tick: () => void
    plugins?: PluginManager
  },
  bindings = defaults,
) {
  let alive = true
  const stops: (() => void)[] = []
  const clockTimer = useIntervalFn(tick, 10_000, { immediate: false })
  const backupTimer = useIntervalFn(
    () => {
      void workspace.backupNow()
    },
    60_000,
    { immediate: false },
  )
  function own(stop: () => void) {
    if (alive) stops.push(stop)
    else stop()
  }
  onMounted(() => {
    // Attach after child review/editor shortcuts, preserving defaultPrevented ordering.
    own(useEventListener(window, 'keydown', globalKeydown))
    own(plugins ? plugins.listenPluginPreferences() : bindings.listenPluginPreferences())
    own(bindings.listenPreferences())
    void bindings.connectLearningReader(workspace).then(own)
    void bindings.connectWorkspaceMonitor(workspace).then(own)
    void (plugins?.initializePlugins() ?? Promise.resolve())
      .catch(() => {})
      .then(() => {
        if (alive) return workspace.init()
      })
    backupTimer.resume()
    clockTimer.resume()
  })
  onUnmounted(() => {
    alive = false
    for (const stop of stops.splice(0)) stop()
    void plugins?.dispose()
    void workspace.close()
  })
}
