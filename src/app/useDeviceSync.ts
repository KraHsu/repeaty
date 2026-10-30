import { computed, onScopeDispose, provide, shallowRef, watch, type Ref } from 'vue'
import { createDeviceSync } from '@repeaty-platform'
import type { useLibrary } from '../composables/useLibrary'
import {
  emptySyncUiState,
  syncErrorMessage,
  type DeviceSyncController,
  type DeviceSyncOptions,
} from '../sync/controller'
import { syncUiKey, type SyncUiController } from '../sync/ui'

type Factory = (options: DeviceSyncOptions) => Promise<DeviceSyncController>
const owners = new WeakMap<
  () => Promise<void>,
  { owner?: symbol; controller?: DeviceSyncController; closing: Promise<void> }
>()

/** App lifetime owns the transport. Visiting settings only observes this controller. */
export function useDeviceSync(
  workspace: ReturnType<typeof useLibrary>,
  blockedReason: Readonly<Ref<string | null>>,
  afterApply?: () => Promise<void>,
  factory: Factory | undefined = createDeviceSync,
): SyncUiController {
  const selected = shallowRef<DeviceSyncController>()
  const fallback = shallowRef(emptySyncUiState())
  const owner = Symbol('device-sync-owner')
  const shared = owners.get(workspace.close) ?? { closing: Promise.resolve() }
  owners.set(workspace.close, shared)
  shared.owner = owner
  let alive = true,
    generation = 0,
    timer: ReturnType<typeof setTimeout> | undefined
  function close() {
    clearTimeout(timer)
    const previous = selected.value ?? shared.controller
    selected.value = undefined
    if (previous) shared.closing = shared.closing.then(() => previous.dispose()).catch(() => {})
    shared.controller = undefined
  }
  function poll(controller: DeviceSyncController, sequence: number) {
    if (!alive || shared.owner !== owner || sequence !== generation) return
    timer = setTimeout(() => {
      if (!alive || shared.owner !== owner || sequence !== generation) return
      void controller.refresh().finally(() => poll(controller, sequence))
    }, 3_000)
  }
  watch(
    [workspace.scope, workspace.ready],
    async ([scope, ready]) => {
      if (shared.owner !== owner) return
      const sequence = ++generation
      close()
      fallback.value = emptySyncUiState()
      if (!factory || !ready || !scope) return
      const current = () =>
        alive &&
        shared.owner === owner &&
        generation === sequence &&
        workspace.ready.value &&
        workspace.scope.value === scope
      try {
        const setup = shared.closing.then(async () => {
          if (!current()) return
          const controller = await factory({
            scope,
            current,
            blockedReason: () => blockedReason.value,
            apply: (expectedScope, revision, library, options) =>
              workspace.applyDeviceSync(expectedScope, revision, library, options),
            afterApply,
          })
          if (!current()) {
            await controller.dispose()
            return
          }
          selected.value = controller
          shared.controller = controller
          return controller
        })
        // Include an unfinished factory in the barrier: its late disposal must precede the next owner.
        shared.closing = setup.then(
          () => {},
          () => {},
        )
        const controller = await setup
        if (!controller || !current()) return
        await controller.refresh()
        poll(controller, sequence)
      } catch (issue) {
        if (current())
          fallback.value = { ...emptySyncUiState(), error: syncErrorMessage(issue), phase: 'error' }
      }
    },
    { immediate: true, flush: 'sync' },
  )
  const facade: SyncUiController = {
    state: computed(() => selected.value?.state.value ?? fallback.value),
    run: async (action) => {
      await selected.value?.run(action)
    },
  }
  provide(syncUiKey, facade)
  onScopeDispose(() => {
    alive = false
    generation++
    clearTimeout(timer)
    if (shared.owner === owner) {
      shared.owner = undefined
      close()
    }
  })
  return facade
}
