// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createApp, nextTick, ref, shallowReactive, type App } from 'vue'
import SettingsPage from './SettingsPage.vue'
import type { PluginInstallation } from '../plugins/types'
import type { SettingsEntry } from '../settings/types'

const boundary = vi.hoisted(() => ({
  state: {} as {
    installations: PluginInstallation[]
    scope: { value: string }
    application: SettingsEntry[]
  },
}))
vi.mock('../plugins', () => ({
  usePlugins: () => ({ installedPlugins: boundary.state.installations, pluginEnabled: () => true }),
}))
vi.mock('../plugins/manager', () => ({
  usePluginManager: () => ({ pluginScope: boundary.state.scope }),
}))
vi.mock('../settings/application', () => ({
  createApplicationSettings: () => boundary.state.application,
}))
let app: App | undefined
let host: HTMLDivElement
beforeEach(() => {
  boundary.state = {
    installations: shallowReactive([]),
    scope: ref('one'),
    application: [
      {
        ownerId: 'application',
        scope: 'one',
        isCurrent: () => true,
        contribution: {
          id: 'appearance',
          title: 'Appearance',
          category: [
            { id: 'general', title: 'General' },
            { id: 'appearance', title: 'Appearance' },
          ],
          fields: [{ key: 'name', label: 'Application field', modelValue: 'app', onChange() {} }],
        },
      },
    ],
  }
  host = document.createElement('div')
  document.body.append(host)
})
afterEach(() => {
  app?.unmount()
  host.remove()
})
function plugin(path: string[]) {
  boundary.state.installations.push({
    plugin: {
      id: 'example',
      label: 'Example',
      kind: 'frontend',
      version: 1,
      reviewPanel: { render: () => null },
    },
    settings: shallowReactive([
      {
        id: 'display',
        title: 'Plugin preferences',
        category: path.map((id) => ({ id, title: id })),
        fields: [{ key: 'name', label: 'Plugin field', modelValue: 'plugin', onChange() {} }],
      },
    ]),
  })
}
function mount() {
  app = createApp(SettingsPage)
  app.mount(host)
}
function category(key: string) {
  return host.querySelector<HTMLButtonElement>(`[data-category-key="${key}"]`)!
}
it('merges application and plugin fields in one category and keeps vertical keyboard navigation', async () => {
  plugin(['general', 'appearance'])
  mount()
  const navigation = host.querySelector('[role=tablist]')!
  expect(navigation.getAttribute('aria-orientation')).toBe('vertical')
  expect(host.querySelectorAll('[data-category-key="general.appearance"]')).toHaveLength(1)
  expect(category('general.appearance').title).toBe(
    category('general.appearance').textContent?.trim(),
  )
  expect(host.querySelectorAll('.settings-panel .ui-setting-field')).toHaveLength(2)
  expect(
    [...host.querySelectorAll('[role=tab]')].some(
      (button) => button.textContent?.trim() === '插件设置',
    ),
  ).toBe(false)
  category('general').focus()
  category('general').dispatchEvent(
    new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }),
  )
  await nextTick()
  await nextTick()
  expect(category('general.appearance').getAttribute('aria-selected')).toBe('true')
  expect(document.activeElement).toBe(category('general.appearance'))
  expect(host.querySelectorAll('.settings-panel input')).toHaveLength(2)
  category('general.appearance').dispatchEvent(
    new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }),
  )
  await nextTick()
  await nextTick()
  expect(document.activeElement).toBe(category('general'))
})
it('selects an existing application category when the active plugin-only branch is removed', async () => {
  plugin(['study', 'review'])
  mount()
  category('study.review').click()
  await nextTick()
  expect(host.querySelector('.plugin-configuration')).not.toBeNull()
  boundary.state.installations.splice(0)
  await nextTick()
  await nextTick()
  expect(category('general').getAttribute('aria-selected')).toBe('true')
  expect(host.querySelector('[data-category-key="study"]')).toBeNull()
  expect(host.querySelector('.plugin-configuration')).toBeNull()
  expect(host.querySelector('input')?.value).toBe('app')
})
