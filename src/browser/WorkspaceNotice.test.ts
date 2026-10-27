// @vitest-environment happy-dom
import { expect, it } from 'vitest'
import { createApp } from 'vue'
import WorkspaceNotice from './WorkspaceNotice.vue'
import { useBrowserWorkspaceStore } from '../stores/browser-workspace'
import { createPinia, storeToRefs } from 'pinia'

it('only protects unsaved trial changes in the active scope and removes the listener on unmount', () => {
  const pinia = createPinia()
  const { active: browserWorkspace } = storeToRefs(useBrowserWorkspaceStore(pinia))
  const host = document.createElement('div')
  document.body.append(host)
  browserWorkspace.value = {
    scope: 'trial',
    name: '本地库',
    id: crypto.randomUUID(),
    revision: 1,
    changed: false,
  }
  const app = createApp(WorkspaceNotice, { scope: 'trial' }).use(pinia)
  app.mount(host)
  const leaving = () => {
    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    return event.defaultPrevented
  }
  try {
    expect(leaving()).toBe(false)
    browserWorkspace.value = { ...browserWorkspace.value, changed: true }
    expect(leaving()).toBe(true)
    browserWorkspace.value = { ...browserWorkspace.value, scope: 'another-trial' }
    expect(leaving()).toBe(false)
    browserWorkspace.value = { ...browserWorkspace.value, scope: 'trial' }
    app.unmount()
    expect(leaving()).toBe(false)
  } finally {
    browserWorkspace.value = null
    host.remove()
  }
})
