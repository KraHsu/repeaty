import { onScopeDispose, watch } from 'vue'
import { preferences } from '../preferences'

/** One application-owned theme drives native controls, shared UI, and plugin surfaces. */
export function useColorTheme() {
  const systemTheme = window.matchMedia('(prefers-color-scheme: dark)')
  const applyTheme = () => {
    const dark =
      preferences.theme === 'dark' || (preferences.theme === 'system' && systemTheme.matches)
    document.documentElement.classList.toggle('dark', dark)
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
  }
  watch(() => preferences.theme, applyTheme, { immediate: true, flush: 'sync' })
  systemTheme.addEventListener('change', applyTheme)
  onScopeDispose(() => systemTheme.removeEventListener('change', applyTheme))
}
