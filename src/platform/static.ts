import { ref, defineAsyncComponent, type Component } from 'vue'
export const workspaceAvailable = ref(true)
import { createRepository } from '../core/storage'
import type { LearningReader } from '../core/learning-reader'
export const AccountControls: Component | undefined = undefined
export const PlatformSettings: Component | undefined = undefined
export const DraftWorkbench: Component | undefined = undefined
export const WorkspaceBrowser = defineAsyncComponent(
  () => import('../browser/WorkspaceBrowser.vue'),
)
export const WorkspaceNotice = defineAsyncComponent(() => import('../browser/WorkspaceNotice.vue'))
export async function initializePlatform() {}
export async function connectLearningReader(_reader: LearningReader): Promise<() => void> {
  return () => {}
}
export const ServerConnection: Component | undefined = undefined
export async function createWorkspaceRepository(onBlocked: () => void) {
  return createRepository('repeaty', onBlocked, { compactHistory: true })
}

export const createExportFile:
  ((filename: string) => Promise<WritableStream<Uint8Array>>) | undefined = undefined

export const workspacePendingCount = ref(0)
export const workspaceDetectionError = ref(false)
export async function connectWorkspaceMonitor(_reader: LearningReader): Promise<() => void> {
  return () => {}
}
