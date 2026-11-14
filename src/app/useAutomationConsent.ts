import { shallowRef, watch, onScopeDispose, type Ref } from 'vue'
import type { AutomationConsent, AutomationIdentity } from '../plugins/automation'
import type { AutomationPreview, AutomationScope } from '@repeaty/plugin-api'
export type AutomationPrompt =
  | { kind: 'grant'; owner: AutomationIdentity; scope: AutomationScope; write: boolean }
  | { kind: 'apply'; owner: AutomationIdentity; preview: AutomationPreview }
export function useAutomationConsent(scope: Ref<string>) {
  const prompt = shallowRef<AutomationPrompt>()
  let pending: ((answer: boolean) => void) | undefined
  function resolve(answer: boolean) {
    const done = pending
    pending = undefined
    prompt.value = undefined
    done?.(answer)
  }
  function ask(request: AutomationPrompt) {
    if (pending || scope.value !== request.owner.scope || request.owner.signal.aborted)
      return Promise.resolve(false)
    return new Promise<boolean>((finish) => {
      const aborted = () => resolve(false)
      pending = (answer) => {
        request.owner.signal.removeEventListener('abort', aborted)
        finish(answer)
      }
      request.owner.signal.addEventListener('abort', aborted, { once: true })
      prompt.value = request
    })
  }
  watch(scope, () => resolve(false), { flush: 'sync' })
  onScopeDispose(() => resolve(false))
  const consent: AutomationConsent = {
    authorize: (owner, input) => ask({ kind: 'grant', owner, ...input }),
    apply: (owner, preview) => ask({ kind: 'apply', owner, preview }),
  }
  return { prompt, resolve, consent }
}
