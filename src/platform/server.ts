import { defineAsyncComponent } from 'vue'
import { createServerRepository } from '../backend/repository'
export const ServerConnection = defineAsyncComponent(
  () => import('../components/ServerConnection.vue'),
)
export async function createWorkspaceRepository(_onBlocked: () => void) {
  return createServerRepository()
}
