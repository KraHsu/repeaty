import { defineStore } from 'pinia'
import { computed, onScopeDispose } from 'vue'
import { createLibraryState } from '../composables/library-state'
import { createLibraryService } from '../application/library'
import { createWorkspaceRepository } from '@repeaty-platform'
import { remoteWorkspace, desktopEdition } from '../edition'
import { usePlugins } from '../plugins'

export const useLibraryStore = defineStore('library', () => {
  const { canReviewCard } = usePlugins()
  const state = createLibraryState()
  const service = createLibraryService(state, {
    createWorkspaceRepository,
    remoteWorkspace,
    desktopEdition,
    canReviewCard,
  })
  onScopeDispose(() => {
    void service.commands.close()
  })
  return {
    ...state,
    ...service.commands,
    lastOperation: computed(service.getters.lastOperation),
    canUndoOperation: computed(service.getters.canUndoOperation),
    canRedoOperation: computed(service.getters.canRedoOperation),
    lastRedoOperation: computed(service.getters.lastRedoOperation),
    canUndoReading: computed(service.getters.canUndoReading),
  }
})
