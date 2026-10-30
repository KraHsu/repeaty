import { shallowRef, watch, onScopeDispose, type Ref } from 'vue'
import type { PluginNetworkIdentity, PluginNetworkConsent } from '../plugins/network'
export function usePluginNetworkConsent(scope: Ref<string>) {
  const prompt = shallowRef<{ owner: PluginNetworkIdentity; origin: string }>()
  let pending: ((answer: boolean) => void) | undefined
  function resolve(answer: boolean) {
    const finish = pending
    pending = undefined
    prompt.value = undefined
    finish?.(answer)
  }
  const consent: PluginNetworkConsent = (owner, origin) => {
    if (pending || owner.signal.aborted || scope.value !== owner.scope)
      return Promise.resolve(false)
    return new Promise<boolean>((finish) => {
      const abort = () => resolve(false)
      pending = (answer) => {
        owner.signal.removeEventListener('abort', abort)
        finish(answer)
      }
      owner.signal.addEventListener('abort', abort, { once: true })
      prompt.value = { owner, origin }
    })
  }
  watch(scope, () => resolve(false), { flush: 'sync' })
  onScopeDispose(() => resolve(false))
  return { consent, prompt, resolve }
}
