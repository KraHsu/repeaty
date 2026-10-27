import { type DisplayMessage } from '../i18n'
import { ref, watch } from 'vue'
import { notify, dismissInfoNotifications } from '../notifications'
import { onScopeDispose } from 'vue'
import type { useLibrary } from '../composables/useLibrary'
import type { useStudyClock } from './useStudyClock'
import { createScopedActionRunner } from '../application/scoped-actions'
export function useOperationRunner({
  workspace,
  refreshClock,
}: {
  workspace: ReturnType<typeof useLibrary>
  refreshClock: ReturnType<typeof useStudyClock>['refreshClock']
}) {
  let appAlive = true
  onScopeDispose(() => {
    appAlive = false
  })
  const notice = ref<{ text: DisplayMessage; error: boolean } | null>(null)
  const run = createScopedActionRunner({
    scope: () => workspace.scope.value,
    alive: () => appAlive,
    start: dismissInfoNotifications,
    success(message) {
      refreshClock()
      notice.value = message ? { text: message, error: false } : null
    },
    failure(error) {
      notice.value = { text: error instanceof Error ? error : '操作失败，请重试。', error: true }
    },
  })
  watch(notice, (entry) => {
    if (entry) notify(entry.text, entry.error ? 'error' : 'info')
  })
  return { notice, run }
}
