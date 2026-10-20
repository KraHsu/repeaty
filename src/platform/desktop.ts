import { defineAsyncComponent, ref } from 'vue'
import { createRepository } from '../core/storage'
import { createServerRepository } from '../backend/repository'
import { setApiTransport } from '../backend/client'
import { remoteWorkspace } from '../edition'
import { getConfig, upstreamTransport, handleExternalLinks } from '../desktop/native'
export const desktopEndpoint = ref('')
export const DraftWorkbench = defineAsyncComponent(() => import('../desktop/DraftWorkbench.vue'))
export const AccountControls = defineAsyncComponent(() => import('../desktop/DesktopSettings.vue'))
export const ServerConnection = defineAsyncComponent(
  () => import('../components/ServerConnection.vue'),
)
export async function initializePlatform() {
  const config = await getConfig()
  desktopEndpoint.value = config.endpoint
  remoteWorkspace.value = Boolean(config.endpoint)
  setApiTransport(upstreamTransport)
  handleExternalLinks()
}
export async function createWorkspaceRepository(onBlocked: () => void) {
  return remoteWorkspace.value
    ? createServerRepository(desktopEndpoint.value)
    : createRepository('repeaty', onBlocked, { compactHistory: true })
}

export { createExportFile } from '../desktop/exports'
export { connectLearningReader } from '../desktop/mcp'
