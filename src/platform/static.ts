import type { Component } from 'vue'
import { createRepository } from '../core/storage'
export const AccountControls: Component | undefined = undefined
export async function initializePlatform() {}
export const ServerConnection: Component | undefined = undefined
export async function createWorkspaceRepository(onBlocked: () => void) {
  return createRepository('repeaty', onBlocked, { compactHistory: true })
}

export const createExportFile:
  ((filename: string) => Promise<WritableStream<Uint8Array>>) | undefined = undefined
