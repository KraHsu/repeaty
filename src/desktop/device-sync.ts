import { invoke } from '@tauri-apps/api/core'
import { currentWorkspace, hydrateSettings, workspaceStatus } from './workspaces'
import { restorePreferences } from '../preferences'
import { createSyncController, type DeviceSyncOptions } from '../sync/controller'

export async function createDeviceSync(options: DeviceSyncOptions) {
  const active = await currentWorkspace()
  if (!options.current() || options.scope !== `local:workspace:${active.id}`)
    throw new Error('sync-workspace-changed')
  const current = () => options.current() && workspaceStatus.value?.active?.token === active.token
  return createSyncController({
    ...options,
    current,
    request: (method, payload = {}) =>
      invoke('device_sync_request', { token: active.token, method, payload }),
    async afterApply() {
      if (!current()) return
      await hydrateSettings()
      if (!current()) return
      restorePreferences()
      await options.afterApply?.()
    },
  })
}
