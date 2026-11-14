import { onScopeDispose, watch } from 'vue'
import { preferences } from '../preferences'
import { appearance, appearanceVariables } from '../appearance'
import '../styles/appearance.css'

/** One application-owned theme drives native controls, shared UI, and plugin surfaces. */
export function useColorTheme() {
  const systemTheme = window.matchMedia('(prefers-color-scheme: dark)')
  const applied = new Set<string>()
  const applyTheme = () => {
    const dark =
      preferences.theme === 'dark' || (preferences.theme === 'system' && systemTheme.matches)
    document.documentElement.classList.toggle('dark', dark)
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
    const root = document.documentElement
    const vars = appearanceVariables(appearance, dark)
    for (const name of applied) if (!(name in vars)) root.style.removeProperty(name)
    for (const [name, value] of Object.entries(vars)) {
      root.style.setProperty(name, value)
      applied.add(name)
    }
    root.style.fontSize = `${appearance.interfaceScale}%`
    root.dataset.reduceMotion = String(appearance.reduceMotion)
    root.dataset.strongContrast = String(appearance.strongContrast)
    root.dataset.dimImages = String(appearance.dimImages)
    root.dataset.pdfMode = appearance.pdfMode
    root.dataset.fontSmoothing = appearance.fontSmoothing
  }
  watch([() => preferences.theme, () => appearance], applyTheme, {
    immediate: true,
    deep: true,
    flush: 'sync',
  })
  systemTheme.addEventListener('change', applyTheme)
  onScopeDispose(() => systemTheme.removeEventListener('change', applyTheme))
}
