import { shallowReactive } from 'vue'
import { DraftSession } from '../core/draft-proposals'
import type { useLibrary } from '../composables/useLibrary'

export type DraftWorkspace = ReturnType<typeof useLibrary>
export const draftSession = shallowReactive(new DraftSession())
