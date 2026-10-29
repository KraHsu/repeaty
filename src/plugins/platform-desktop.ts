import { invoke } from '@tauri-apps/api/core'
import { currentWorkspace, workspaceApi } from '../desktop/workspaces'
export const currentPluginWorkspace = currentWorkspace
async function current(scope?: string) {
  const active = await currentWorkspace()
  if (scope && scope !== `local:workspace:${active.id}`) throw new Error('stale-workspace-session')
  return active
}
export async function callPluginHost(
  id: string,
  operation: string,
  payload: unknown = {},
  scope?: string,
): Promise<unknown> {
  const active = await current(scope)
  return invoke('plugin_host', { token: active.token, id, operation, payload })
}
export async function readPluginData(plugin: string, id: string, scope: string): Promise<unknown> {
  const active = await current(scope)
  return workspaceApi('workspace_read', {
    token: active.token,
    request: { type: 'value', namespace: `plugin:${plugin}`, id },
  })
}
export async function writePluginData(
  plugin: string,
  id: string,
  value: unknown,
  scope: string,
): Promise<void> {
  const active = await current(scope)
  await workspaceApi('workspace_write', {
    token: active.token,
    request: { type: 'value', namespace: `plugin:${plugin}`, id, value: value ?? null },
  })
}
