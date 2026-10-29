// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it } from 'vitest'
import { createApp, h, nextTick, ref, shallowReactive, type App } from 'vue'
import type { PluginInstallation } from '../plugins/types'
import type { PluginSettingField, PluginSettingsContribution } from '../plugins/settings'
import SettingsContent from './SettingsContent.vue'
import type { SettingsEntry } from '../settings/types'
import { PluginRuntime } from '../plugins/runtime'
import { setLocale } from '../i18n'

const boundary = {
  state: {} as {
    installations: PluginInstallation[]
    scope: { value: string }
  },
}
let app: App | undefined
let host: HTMLDivElement
beforeEach(() => {
  setLocale('zh-CN')
  boundary.state = { installations: shallowReactive([]), scope: ref('workspace-one') }
  host = document.createElement('div')
  document.body.append(host)
})
afterEach(() => {
  app?.unmount()
  app = undefined
  host.remove()
  setLocale('zh-CN')
})
function install(id: string, contribution: PluginSettingsContribution) {
  const installation: PluginInstallation = {
    plugin: { id, kind: 'frontend', label: id, version: 1, reviewPanel: { render: () => null } },
    settings: shallowReactive([contribution]),
  }
  boundary.state.installations.push(installation)
  return installation
}
function mount() {
  const cache = new WeakMap<PluginSettingsContribution, SettingsEntry>()
  app = createApp({
    render: () =>
      h(SettingsContent, {
        scope: boundary.state.scope.value,
        entries: boundary.state.installations.flatMap((installation) =>
          (installation.settings ?? []).map((contribution) => {
            const previous = cache.get(contribution)
            if (previous?.scope === boundary.state.scope.value) return previous
            const scope = boundary.state.scope.value
            const entry: SettingsEntry = {
              ownerId: `plugin:${installation.plugin.id}`,
              pluginId: installation.plugin.id,
              contribution,
              scope,
              isCurrent: () =>
                scope === boundary.state.scope.value &&
                boundary.state.installations.includes(installation) &&
                !!installation.settings?.includes(contribution),
            }
            cache.set(contribution, entry)
            return entry
          }),
        ),
      }),
  })
  app.mount(host)
}
async function change(input: HTMLInputElement, value: string) {
  input.value = value
  input.dispatchEvent(new Event('change', { bubbles: true }))
  await nextTick()
}
it('renders plugin-owned reactive values through native fields with collision-free host labels', async () => {
  const value = ref(7)
  const title = ref('Display')
  const field: PluginSettingField = {
    key: 'count',
    id: 'requested-id',
    label: 'Count',
    type: 'number',
    min: 1,
    max: 50,
    get modelValue() {
      return value.value
    },
    onChange(next) {
      value.value = Number(next)
    },
  }
  install('a-b', {
    id: 'c',
    get title() {
      return title.value
    },
    fields: [field],
  })
  install('a', { id: 'b-c', title: 'Other', fields: [{ ...field, onChange() {} }] })
  mount()
  await nextTick()
  const inputs = host.querySelectorAll('input')
  expect(inputs[0]!.id).not.toBe(inputs[1]!.id)
  expect(inputs[0]!.labels?.[0]?.textContent).toBe('Count')
  await change(inputs[0]!, '12')
  expect(value.value).toBe(12)
  value.value = 18
  title.value = 'Updated display'
  await nextTick()
  expect(inputs[0]!.value).toBe('18')
  expect(host.querySelector('.plugin-configuration h2')?.textContent).toBe('Updated display')
})
it('shows current save failures and ignores promises from superseded edits or removed contributions', async () => {
  const failures: ((issue: Error) => void)[] = []
  const contribution: PluginSettingsContribution = {
    id: 'display',
    title: 'Display',
    fields: [
      {
        key: 'count',
        label: 'Count',
        type: 'number',
        modelValue: 7,
        onChange: () => new Promise<void>((_resolve, reject) => failures.push(reject)),
      },
    ],
  }
  const installation = install('history', contribution)
  mount()
  const input = host.querySelector('input')!
  await change(input, '8')
  await change(input, '9')
  failures[0]!(new Error('Earlier request failed'))
  await nextTick()
  await nextTick()
  expect(host.querySelector('[role=alert]')).toBeNull()
  failures[1]!(new Error('Current request failed'))
  await nextTick()
  await nextTick()
  expect(input.getAttribute('aria-invalid')).toBe('true')
  expect(host.querySelector('[role=alert]')?.textContent).toBe('Current request failed')
  await change(input, '10')
  ;(installation.settings as PluginSettingsContribution[]).splice(0)
  failures[2]!(new Error('Removed contribution failed'))
  await nextTick()
  await nextTick()
  expect(host.querySelector('input')).toBeNull()
  expect(host.querySelector('[role=alert]')).toBeNull()
})

it('does not reuse an already displayed error in a new workspace with the same plugin and field ids', async () => {
  const fields = (): PluginSettingField[] => [
    {
      key: 'count',
      label: 'Count',
      type: 'number',
      modelValue: 7,
      onChange() {
        throw new Error('First workspace failed')
      },
    },
  ]
  install('history', { id: 'display', title: 'Display', fields: fields() })
  mount()
  await change(host.querySelector('input')!, '8')
  expect(host.querySelector('[role=alert]')?.textContent).toBe('First workspace failed')
  boundary.state.scope.value = 'workspace-two'
  boundary.state.installations.splice(0)
  install('history', { id: 'display', title: 'Display', fields: fields() })
  await nextTick()
  expect(host.querySelector('[role=alert]')).toBeNull()
  expect(host.querySelector('input')?.getAttribute('aria-invalid')).not.toBe('true')
})

it('remounts a same-source registration and ignores its previous pending save', async () => {
  const runtime = new PluginRuntime()
  const failures: ((issue: Error) => void)[] = []
  const source: PluginSettingsContribution = {
    id: 'display',
    title: 'Display',
    fields: [
      {
        key: 'count',
        label: 'Count',
        type: 'number',
        modelValue: 7,
        onChange: () => new Promise<void>((_resolve, reject) => failures.push(reject)),
      },
    ],
  }
  let register!: (contribution: PluginSettingsContribution) => () => void
  let remove!: () => void
  try {
    await runtime.load(
      {
        manifest: {
          id: 'history',
          name: 'History',
          version: '1.0.0',
          apiVersion: 1,
          dataVersion: 1,
          kind: 'frontend',
        },
        main: 'test plugin',
        styles: '',
      },
      async (_code, _disposers, registerSettings) => {
        register = registerSettings
        remove = register(source)
        return {
          default: {
            id: 'history',
            label: 'History',
            kind: 'frontend',
            version: 1,
            reviewPanel: { render: () => null },
          },
        }
      },
    )
    boundary.state.installations = runtime.installations
    mount()
    const oldInput = host.querySelector('input')!
    await change(oldInput, '8')
    remove()
    register(source)
    await nextTick()
    expect(host.querySelector('input')).not.toBe(oldInput)
    expect(host.querySelector('input')?.value).toBe('7')
    failures[0]!(new Error('Old registration failed'))
    await nextTick()
    await nextTick()
    expect(host.querySelector('[role=alert]')).toBeNull()
  } finally {
    await runtime.close()
  }
})

it('retranslates host save errors when the interface language changes', async () => {
  install('history', {
    id: 'display',
    title: 'Display',
    fields: [
      {
        key: 'count',
        label: 'Count',
        type: 'number',
        modelValue: 7,
        onChange() {
          throw new Error('无法保存插件设置，请重试。')
        },
      },
    ],
  })
  mount()
  await change(host.querySelector('input')!, '8')
  expect(host.querySelector('[role=alert]')?.textContent).toBe('无法保存插件设置，请重试。')
  setLocale('en')
  await nextTick()
  expect(host.querySelector('[role=alert]')?.textContent).toBe(
    'Could not save plugin settings. Try again.',
  )
})
