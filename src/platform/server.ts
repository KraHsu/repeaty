import { defineAsyncComponent } from 'vue'
import { createServerRepository } from '../backend/repository'
export const AccountControls = defineAsyncComponent(
  () => import('../components/AccountControls.vue'),
)
export async function initializePlatform() {}
export const ServerConnection = defineAsyncComponent(
  () => import('../components/ServerConnection.vue'),
)
export async function createWorkspaceRepository(_onBlocked: () => void) {
  return createServerRepository()
}

export { createExportFile, connectLearningReader, DraftWorkbench } from './static'
