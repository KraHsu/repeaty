import { restorePreferences } from '../preferences'
import { restorePluginPreferences } from '../plugins'
import { defineAsyncComponent } from 'vue'
import type { Component } from 'vue'
import { createNativeRepository } from '../desktop/repository'
import {
  currentWorkspace,
  initializeWorkspaces,
  installWorkspaceStores,
} from '../desktop/workspaces'
import { handleExternalLinks } from '../desktop/native'
export const AccountControls: Component | undefined = undefined
export const ServerConnection: Component | undefined = undefined
export const WorkspaceNotice: Component | undefined = undefined
export const DesktopTitlebar = defineAsyncComponent(() => import('../desktop/DesktopTitlebar.vue'))
export const DraftWorkbench = defineAsyncComponent(() => import('../desktop/DraftWorkbench.vue'))
export const WorkspaceBrowser = defineAsyncComponent(
  () => import('../desktop/WorkspaceManager.vue'),
)
export const PlatformSettings = defineAsyncComponent(() => import('../desktop/DesktopSettings.vue'))
export const WorkspaceBackupTools = defineAsyncComponent(
  () => import('../desktop/WorkspaceRecovery.vue'),
)
export { connectAutomaticBackups } from '../desktop/workspace-backups'
export { workspaceAvailable } from '../desktop/workspaces'
export async function initializePlatform() {
  installWorkspaceStores()
  handleExternalLinks()
  await initializeWorkspaces()
  restorePreferences()
  restorePluginPreferences()
}
export async function createWorkspaceRepository(_onBlocked: () => void) {
  return createNativeRepository(await currentWorkspace())
}
export { createExportFile } from '../desktop/exports'
export { connectLearningReader } from '../desktop/mcp'
export { connectDesktopCloseGuard as connectWindowCloseGuard } from '../desktop/experience'
export { connectWorkspaceLeaveGuard } from '../desktop/workspaces'

export {
  connectWorkspaceMonitor,
  workspacePendingCount,
  workspaceDetectionError,
} from '../desktop/workspace-monitor'
