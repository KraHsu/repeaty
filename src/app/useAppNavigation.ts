import { storeToRefs, type Pinia } from 'pinia'
import { computed, getCurrentScope, onScopeDispose, ref } from 'vue'
import { useNavigationStore } from '../stores/navigation'
export function useAppNavigation(pinia?: Pinia, beforeLeave?: () => boolean | Promise<boolean>) {
  const store = useNavigationStore(pinia)
  let alive = true,
    generation = 0
  function location() {
    return {
      tab: store.tab,
      pluginPage: store.pluginPage ? { ...store.pluginPage } : undefined,
      selectedDeck: store.selectedDeck,
      searchQuery: store.searchQuery,
      filterState: store.filterState,
      historyCardId: store.historyCardId,
    }
  }
  type Location = ReturnType<typeof location>
  const past: Location[] = [],
    future: Location[] = []
  // Ref-backed lengths expose availability without persisting navigation history.
  const historyVersion = ref(0)
  const mayTravel = () => !store.review && !store.mixed
  function visit(action: () => void) {
    return transition(() => {
      const previous = location(),
        record = mayTravel()
      action()
      if (record && JSON.stringify(previous) !== JSON.stringify(location())) {
        past.push(previous)
        if (past.length > 100) past.shift()
        future.length = 0
        historyVersion.value++
      }
    })
  }
  function restore(value: Location) {
    store.navigate(value.tab)
    store.pluginPage = value.pluginPage ? { ...value.pluginPage } : undefined
    store.selectedDeck = value.selectedDeck
    store.searchQuery = value.searchQuery
    store.filterState = value.filterState
    store.historyCardId = value.historyCardId
  }
  function travel(back: boolean) {
    if (!mayTravel()) return false
    const from = back ? past : future,
      to = back ? future : past
    if (!from.length) return false
    return transition(() => {
      if (!mayTravel() || !from.length) return
      const next = from.pop()!
      to.push(location())
      restore(next)
      historyVersion.value++
    })
  }
  if (getCurrentScope())
    onScopeDispose(() => {
      alive = false
      generation++
    })
  function transition(action: () => void): boolean | Promise<boolean> {
    const request = ++generation
    const apply = (allowed: boolean) => {
      if (!allowed || !alive || request !== generation) return false
      action()
      return true
    }
    const allowed = beforeLeave?.() ?? true
    return typeof allowed === 'boolean' ? apply(allowed) : allowed.then(apply, () => false)
  }
  return {
    ...storeToRefs(store),
    canGoBack: computed(() => {
      void historyVersion.value
      return mayTravel() && past.length > 0
    }),
    canGoForward: computed(() => {
      void historyVersion.value
      return mayTravel() && future.length > 0
    }),
    goBack: () => travel(true),
    goForward: () => travel(false),
    navigate: (next: Parameters<typeof store.navigate>[0], after?: () => void) =>
      visit(() => {
        store.navigate(next)
        after?.()
      }),
    transition,
    openPluginPage: (...args: Parameters<typeof store.openPluginPage>) =>
      visit(() => store.openPluginPage(...args)),
    startReading: () => visit(store.startReading),
    openHistory: (...args: Parameters<typeof store.openHistory>) =>
      visit(() => store.openHistory(...args)),
    openDeck: (...args: Parameters<typeof store.openDeck>) => visit(() => store.openDeck(...args)),
    resetLibrary: () => {
      generation++
      past.length = 0
      future.length = 0
      historyVersion.value++
      store.resetLibrary()
    },
  }
}
