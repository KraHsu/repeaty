// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it } from 'vitest'
import { createApp, defineComponent, h, type Component } from 'vue'
import { createApplicationSettings } from './application'
import { locale, setLocale } from '../i18n'
import { PREFERENCES_KEY, restorePreferences, setPreference } from '../preferences'
import { useSettingsStore } from '../settings-store'

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
  const entries = createApplicationSettings({ scope: () => scope })
  const appearance = entries.find(({ contribution }) => contribution.id === 'appearance')!
  const notifications = entries.find(({ contribution }) => contribution.id === 'notifications')!
  const language = appearance.contribution.fields![0]!
  const info = notifications.contribution.fields![0]!
  language.onChange('en')
  expect(locale.value).toBe('en')
  expect(appearance.contribution.category![0]!.title).toBe('General')
  info.onChange(false)
  expect(JSON.parse(values.get(PREFERENCES_KEY)!)).toEqual({
    theme: 'system',
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

it('provides individual desktop configuration views without registering plugin management in settings', () => {
  const entries = createApplicationSettings({
    scope: () => 'workspace-one',
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
  expect(entries.map(({ contribution }) => contribution.id)).toEqual([
    'appearance',
    'notifications',
    'material-search',
    'material-reading',
    'workspace',
    'mcp',
    'capture',
    'ai',
  ])
  expect(
    entries.some(({ contribution }) => contribution.category?.some(({ id }) => id === 'plugins')),
  ).toBe(false)
})

it('registers translated theme choices in Appearance and guards changes from an inactive library', () => {
  let scope = 'first-library'
  const appearance = createApplicationSettings({ scope: () => scope }).find(
    ({ contribution }) => contribution.id === 'appearance',
  )!
  const theme = appearance.contribution.fields!.find(({ key }) => key === 'theme')!
  expect(theme.modelValue).toBe('system')
  expect(theme.options).toEqual([
    { value: 'system', label: '跟随系统' },
    { value: 'light', label: '浅色' },
    { value: 'dark', label: '深色' },
  ])
  theme.onChange('dark')
  expect(theme.modelValue).toBe('dark')
  expect(JSON.parse(values.get(PREFERENCES_KEY)!)).toMatchObject({ theme: 'dark' })
  setLocale('en')
  expect(theme.label).toBe('Color mode')
  expect(theme.options?.[0]?.label).toBe('Follow system')
  theme.onChange('sepia')
  expect(theme.modelValue).toBe('dark')
  scope = 'second-library'
  theme.onChange('light')
  expect(theme.modelValue).toBe('dark')
})
