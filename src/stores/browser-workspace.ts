import { defineStore } from 'pinia'
import { shallowRef } from 'vue'
export interface BrowserWorkspace {
  scope: string
  id: string
  name: string
  revision: number
  changed: boolean
}
export const useBrowserWorkspaceStore = defineStore('browser-workspace', () => {
  const active = shallowRef<BrowserWorkspace | null>(null)
  function open(workspace: BrowserWorkspace) {
    active.value = workspace
  }
  function markChanged(scope: string) {
    if (active.value?.scope === scope) active.value = { ...active.value, changed: true }
  }
  function clear() {
    active.value = null
  }
  return { active, open, markChanged, clear }
})
