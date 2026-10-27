import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { SourceExcerpt } from '../core/source-data'
import { type CardView, type Deck, type SearchFilter, type StudySession } from '../core/model'

export const useNavigationStore = defineStore('navigation', () => {
  const tab = ref<
    'overview' | 'cards' | 'history' | 'plugins' | 'data' | 'sources' | 'settings' | 'workspace'
  >('overview')
  const historyCardId = ref('')
  const autoStartReading = ref(false)
  const mcpSelection = ref<SourceExcerpt>()
  const selectedDeck = ref('')
  const searchQuery = ref('')
  const filterState = ref<SearchFilter['state']>('all')
  const review = ref<{ deckId?: string; study?: StudySession } | null>(null)
  const mixed = ref<{ cardsPerReading: number } | null>(null)
  const modal = ref<
    | 'deck'
    | 'card'
    | 'confirm'
    | 'import'
    | 'bulkImport'
    | 'snapshot'
    | 'mixed'
    | 'shortcuts'
    | null
  >(null)
  function navigate(next: typeof tab.value) {
    tab.value = next
    review.value = null
    mixed.value = null
    selectedDeck.value = ''
    searchQuery.value = ''
    filterState.value = 'all'
    historyCardId.value = ''
    autoStartReading.value = false
  }
  function startReading() {
    navigate('sources')
    autoStartReading.value = true
  }
  function openHistory(card?: CardView) {
    navigate('history')
    historyCardId.value = card?.id ?? ''
  }
  function openDeck(deck: Deck) {
    navigate('cards')
    selectedDeck.value = deck.id
  }
  function resetLibrary() {
    selectedDeck.value = ''
    searchQuery.value = ''
    filterState.value = 'all'
    historyCardId.value = ''
    autoStartReading.value = false
    mcpSelection.value = undefined
    modal.value = null
    review.value = null
    mixed.value = null
  }

  return {
    tab,
    historyCardId,
    autoStartReading,
    mcpSelection,
    selectedDeck,
    searchQuery,
    filterState,
    review,
    mixed,
    modal,
    navigate,
    startReading,
    openHistory,
    openDeck,
    resetLibrary,
  }
})
