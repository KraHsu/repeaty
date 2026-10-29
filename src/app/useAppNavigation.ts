import { storeToRefs, type Pinia } from 'pinia'
import { getCurrentScope, onScopeDispose } from 'vue'
import { useNavigationStore } from '../stores/navigation'
export function useAppNavigation(pinia?: Pinia, beforeLeave?: () => boolean | Promise<boolean>) {
  const store = useNavigationStore(pinia)
  let alive = true,
    generation = 0
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
    navigate: (next: Parameters<typeof store.navigate>[0], after?: () => void) =>
      transition(() => {
        store.navigate(next)
        after?.()
      }),
    transition,
    openPluginPage: (...args: Parameters<typeof store.openPluginPage>) =>
      transition(() => store.openPluginPage(...args)),
    startReading: () => transition(store.startReading),
    openHistory: (...args: Parameters<typeof store.openHistory>) =>
      transition(() => store.openHistory(...args)),
    openDeck: (...args: Parameters<typeof store.openDeck>) =>
      transition(() => store.openDeck(...args)),
    resetLibrary: () => {
      generation++
      store.resetLibrary()
    },
  }
}
