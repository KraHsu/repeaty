import { defineAsyncComponent, type Component } from 'vue'
import { createServerRepository } from '../backend/repository'
export const AccountControls = defineAsyncComponent(
  () => import('../components/AccountControls.vue'),
)
export async function initializePlatform() {}
export const ServerConnection = defineAsyncComponent(
  () => import('../components/ServerConnection.vue'),
)
export const WorkspaceBrowser: Component | undefined = undefined
export const WorkspaceNotice: Component | undefined = undefined
export async function createWorkspaceRepository(_onBlocked: () => void) {
  return createServerRepository()
}

export {
  createExportFile,
  connectLearningReader,
  DraftWorkbench,
  DesktopTitlebar,
  PlatformSettings,
  createDeviceSync,
  workspaceAvailable,
  connectWorkspaceMonitor,
  workspacePendingCount,
  workspaceDetectionError,
  WorkspaceBackupTools,
  connectAutomaticBackups,
  connectWindowCloseGuard,
  connectWorkspaceLeaveGuard,
} from './static'
