import { storeToRefs, type Pinia } from 'pinia'
import { useNavigationStore } from '../stores/navigation'
export function useAppNavigation(pinia?: Pinia) {
  const store = useNavigationStore(pinia)
  return {
    ...storeToRefs(store),
    navigate: store.navigate,
    openPluginPage: store.openPluginPage,
    startReading: store.startReading,
    openHistory: store.openHistory,
    openDeck: store.openDeck,
    resetLibrary: store.resetLibrary,
  }
}
