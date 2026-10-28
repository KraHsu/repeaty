// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, ref, type Component } from 'vue'
import { createApplicationSettings } from './application'
import { locale, setLocale } from '../i18n'
import { PREFERENCES_KEY, restorePreferences, setPreference } from '../preferences'
import { useSettingsStore } from '../settings-store'

vi.mock('../components/PluginPanel.vue', () => ({
  default: defineComponent({
    props: { focusPlugin: String },
    emits: ['configure'],
    setup:
      (props, { emit }) =>
      () =>
        h(
          'button',
          {
            'data-plugin': props.focusPlugin,
            onClick: () => emit('configure', 'example'),
          },
          'Configure',
        ),
  }),
}))

const cleanups: (() => void)[] = []
let values: Map<string, string>
beforeEach(() => {
  values = new Map()
  useSettingsStore({
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value)
    },
  })
  restorePreferences()
  setLocale('zh-CN')
})
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup())
  setLocale('zh-CN')
})

function mount(component: Component) {
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp(component)
  app.mount(host)
  cleanups.push(() => {
    app.unmount()
    host.remove()
  })
  return host
}

it('keeps builtin declarations reactive and writes only the existing preference records in their active scope', () => {
  let scope = 'first-library'
  const entries = createApplicationSettings({ scope: () => scope, onConfigurePlugin: vi.fn() })
  const appearance = entries.find(({ contribution }) => contribution.id === 'appearance')!
  const notifications = entries.find(({ contribution }) => contribution.id === 'notifications')!
  const language = appearance.contribution.fields![0]!
  const info = notifications.contribution.fields![0]!
  language.onChange('en')
  expect(locale.value).toBe('en')
  expect(appearance.contribution.category![0]!.title).toBe('General')
  info.onChange(false)
  expect(JSON.parse(values.get(PREFERENCES_KEY)!)).toEqual({
    popupInfo: false,
    popupWarning: true,
    popupError: true,
  })
  setPreference('popupInfo', true)
  expect(info.modelValue).toBe(true)
  info.onChange('false')
  expect(info.modelValue).toBe(true)
  scope = 'second-library'
  expect(appearance.isCurrent()).toBe(false)
  info.onChange(false)
  language.onChange('zh-CN')
  expect(info.modelValue).toBe(true)
  expect(locale.value).toBe('en')
  expect(entries.some(({ contribution }) => contribution.id === 'workspace')).toBe(false)
})

it('splits desktop sections and forwards reactive plugin detail targets without allowing stale navigation', async () => {
  const details = ref('first-plugin')
  const configure = vi.fn()
  let scope = 'workspace-one'
  const entries = createApplicationSettings({
    scope: () => scope,
    onConfigurePlugin: configure,
    detailsPlugin: () => details.value,
    platformSettings: defineComponent({
      props: { section: String },
      setup: (props) => () => h('p', { 'data-section': props.section }, props.section),
    }),
  })
  const workspace = entries.find(({ contribution }) => contribution.id === 'workspace')!
  const mcp = entries.find(({ contribution }) => contribution.id === 'mcp')!
  expect(workspace.standalone).toBe(true)
  expect(mcp.standalone).toBe(true)
  expect(mount(workspace.contribution.component!).textContent).toBe('workspace')
  expect(mount(mcp.contribution.component!).textContent).toBe('mcp')
  const plugin = entries.find(({ contribution }) => contribution.id === 'plugins')!
  const host = mount(plugin.contribution.component!)
  expect(host.querySelector('button')?.dataset.plugin).toBe('first-plugin')
  details.value = 'second-plugin'
  await nextTick()
  expect(host.querySelector('button')?.dataset.plugin).toBe('second-plugin')
  host.querySelector('button')!.click()
  expect(configure).toHaveBeenCalledExactlyOnceWith('example')
  scope = 'workspace-two'
  host.querySelector('button')!.click()
  expect(configure).toHaveBeenCalledTimes(1)
})
