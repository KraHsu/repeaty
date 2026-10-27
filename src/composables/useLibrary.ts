import { computed, readonly } from 'vue'
import { createLibraryState } from './library-state'
import { createLibraryService } from '../application/library'
import { createWorkspaceRepository } from '@repeaty-platform'
import { remoteWorkspace, desktopEdition } from '../edition'
import { canReviewCard } from '../plugins'

/** Vue view of the application service; persistence and commands have no component owner. */
export function useLibrary() {
  const state = createLibraryState()
  const service = createLibraryService(state, {
    createWorkspaceRepository,
    remoteWorkspace,
    desktopEdition,
    canReviewCard,
  })
  return {
    ...service.commands,
    library: state.library,
    scope: readonly(state.scope),
    ready: readonly(state.ready),
    busy: readonly(state.busy),
    loadError: readonly(state.loadError),
    backups: readonly(state.backups),
    backupError: readonly(state.backupError),
    readingUndo: readonly(state.readingUndo),
    lastOperation: computed(service.getters.lastOperation),
    canUndoOperation: computed(service.getters.canUndoOperation),
    canUndoReading: computed(service.getters.canUndoReading),
  }
}
