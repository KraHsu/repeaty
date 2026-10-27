import { readonly } from 'vue'
import { storeToRefs, type Pinia } from 'pinia'
import { useLibraryStore } from '../stores/library'
import type { createLibraryService } from '../application/library'

/** Ref-based reader port shared by views, MCP and directory adapters. */
export function useLibrary(pinia?: Pinia) {
  const store = useLibraryStore(pinia)
  const state = storeToRefs(store)
  const actions = Object.fromEntries(
    Object.entries(store).filter(
      ([key, value]) => !key.startsWith('$') && !key.startsWith('_') && typeof value === 'function',
    ),
  ) as ReturnType<typeof createLibraryService>['commands']
  return {
    ...actions,
    library: state.library,
    scope: readonly(state.scope),
    ready: readonly(state.ready),
    busy: readonly(state.busy),
    loadError: readonly(state.loadError),
    backups: readonly(state.backups),
    backupError: readonly(state.backupError),
    readingUndo: readonly(state.readingUndo),
    lastOperation: state.lastOperation,
    canUndoOperation: state.canUndoOperation,
    canUndoReading: state.canUndoReading,
  }
}
