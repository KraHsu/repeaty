import { onMounted, onUnmounted } from 'vue'
import { useEventListener, useIntervalFn } from '@vueuse/core'
import {
  connectLearningReader,
  connectWorkspaceMonitor,
  connectAutomaticBackups,
  connectWindowCloseGuard,
  connectWorkspaceLeaveGuard,
} from '@repeaty-platform'
import { listenPluginPreferences } from '../plugins'
import { listenPreferences } from '../preferences'
import type { PluginManager } from '../plugins/manager'
import type { useLibrary } from '../composables/useLibrary'

const defaults = {
  connectLearningReader,
  connectWorkspaceMonitor,
  connectAutomaticBackups,
  connectWindowCloseGuard,
  connectWorkspaceLeaveGuard,
  listenPluginPreferences,
  listenPreferences,
}
// useLibrary() returns new facades, but the Pinia action is stable per app store.
// A remount must wait for the previous owner's final save and repository close.
const workspaceOwners = new WeakMap<
  () => Promise<void>,
  { owner?: symbol; closing?: Promise<void> }
>()
export function useApplicationLifecycle(
  {
    workspace,
    globalKeydown,
    tick,
    plugins,
    beforeLeave,
    beforeClose,
  }: {
    workspace: ReturnType<typeof useLibrary>
    globalKeydown: (event: KeyboardEvent) => void
    tick: () => void
    plugins?: PluginManager
    beforeLeave?: () => boolean | Promise<boolean>
    beforeClose?: () => Promise<void>
  },
  bindings: Omit<
    typeof defaults,
    'connectAutomaticBackups' | 'connectWindowCloseGuard' | 'connectWorkspaceLeaveGuard'
  > &
    Partial<
      Pick<
        typeof defaults,
        'connectAutomaticBackups' | 'connectWindowCloseGuard' | 'connectWorkspaceLeaveGuard'
      >
    > = defaults,
) {
  let alive = true
  const owner = Symbol('application-lifecycle')
  const shared = workspaceOwners.get(workspace.close) ?? {}
  workspaceOwners.set(workspace.close, shared)
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
  function start() {
    if (!alive || shared.owner !== owner) return
    // Attach after child review/editor shortcuts, preserving defaultPrevented ordering.
    own(useEventListener(window, 'keydown', globalKeydown))
    own(plugins ? plugins.listenPluginPreferences() : bindings.listenPluginPreferences())
    own(bindings.listenPreferences())
    if (beforeLeave) {
      if (bindings.connectWorkspaceLeaveGuard) own(bindings.connectWorkspaceLeaveGuard(beforeLeave))
      void bindings.connectWindowCloseGuard?.(async () => alive && (await beforeLeave())).then(own)
    }
    void bindings.connectLearningReader(workspace).then(own)
    void bindings.connectWorkspaceMonitor(workspace).then(own)
    void bindings.connectAutomaticBackups?.(workspace).then(own)
    void (plugins?.initializePlugins() ?? Promise.resolve())
      .catch(() => {})
      .then(() => {
        if (alive && shared.owner === owner) return workspace.init()
      })
    backupTimer.resume()
    clockTimer.resume()
  }
  onMounted(() => {
    shared.owner = owner
    if (shared.closing) void shared.closing.then(start)
    else start()
  })
  onUnmounted(() => {
    alive = false
    for (const stop of stops.splice(0)) stop()
    void plugins?.dispose()
    if (shared.owner !== owner) {
      void beforeClose?.().catch(() => {})
      return
    }
    shared.owner = undefined
    const previous = shared.closing
    const closing = (previous ?? Promise.resolve())
      .then(() => beforeClose?.())
      .catch(() => {})
      .then(() => workspace.close())
      .catch(() => {})
      .finally(() => {
        if (shared.closing === closing) shared.closing = undefined
      })
    shared.closing = closing
  })
}
