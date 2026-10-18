import type { Component } from 'vue'
import { createRepository } from '../core/storage'
export const ServerConnection: Component | undefined = undefined
export async function createWorkspaceRepository(onBlocked: () => void) {
  return createRepository('repeaty', onBlocked)
}
