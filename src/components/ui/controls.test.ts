// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, ref, type Component } from 'vue'
import ui from '@nuxt/ui/vue-plugin'
import SettingField from './SettingField.vue'
import SettingGroup from './SettingGroup.vue'
import UiButton from './UiButton.vue'
import SettingSection from './SettingSection.vue'
import UiNotice from './UiNotice.vue'
import UiStatus from './UiStatus.vue'
import type { SettingFieldProps, SettingValue } from './types'

const cleanup = new Set<() => void>()
function mount(component: Component, props: Record<string, unknown>, content?: () => unknown) {
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp({
    render: () => h(component, props, content ? { default: content } : undefined),
  })
  app.use(ui)
  app.mount(host)
  cleanup.add(() => {
    app.unmount()
    host.remove()
  })
  return host
}
function field(props: SettingFieldProps) {
  const value = ref<SettingValue>(props.modelValue)
  const updates = vi.fn((next: SettingValue) => {
    value.value = next
  })
  const host = mount(
    {
      setup: () => () =>
        h(SettingField, {
          ...props,
          modelValue: value.value,
          'onUpdate:modelValue': updates,
        }),
    },
    {},
  )
  return { host, value, updates }
}
async function edit(
  element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  value: string,
  phase: 'input' | 'change',
) {
  element.value = value
  element.dispatchEvent(new Event(phase, { bubbles: true }))
  await nextTick()
}
afterEach(() => {
  for (const stop of cleanup) stop()
  cleanup.clear()
})

it('connects visible labels, help and errors to native controls without sharing generated ids', async () => {
  const host = mount(
    {
      render: () =>
        h('div', [
          h(SettingField, {
            label: 'Display name',
            description: 'Visible to you',
            error: 'Required',
            modelValue: '',
          }),
          h(SettingField, { label: 'Other field', modelValue: '' }),
        ]),
    },
    {},
  )
  await nextTick()
  const [input, second] = host.querySelectorAll('input')
  expect(input!.id).not.toBe(second!.id)
  expect(input!.labels?.[0]?.textContent).toBe('Display name')
  expect(input!.getAttribute('aria-invalid')).toBe('true')
  const described = input!.getAttribute('aria-describedby')!.split(' ')
  expect(described.map((id) => host.querySelector(`[id="${id}"]`)?.textContent)).toEqual(
    expect.arrayContaining(['Visible to you', 'Required']),
  )
  expect(host.querySelector('[role="alert"]')?.textContent).toBe('Required')
  expect(second!.labels?.[0]?.textContent).toBe('Other field')
})

it('keeps IME composition local until committed and forwards credential attributes', async () => {
  const { host, value, updates } = field({
    type: 'password',
    label: 'Session',
    modelValue: '',
    maxlength: 8192,
    autocomplete: 'new-password',
    autocapitalize: 'off',
    spellcheck: false,
  })
  const input = host.querySelector('input')!
  expect(input.maxLength).toBe(8192)
  expect(input.autocomplete).toBe('new-password')
  expect(input.getAttribute('autocapitalize')).toBe('off')
  expect(input.getAttribute('spellcheck')).toBe('false')
  input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
  await edit(input, 'zhong', 'input')
  expect(updates).not.toHaveBeenCalled()
  expect(value.value).toBe('')
  input.value = '中文'
  input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
  await nextTick()
  expect(updates).toHaveBeenCalledExactlyOnceWith('中文')
  expect(value.value).toBe('中文')
  expect(input.value).toBe('中文')
})

it('commits valid numbers once and restores empty, out-of-range or fractional integer entries', async () => {
  const { host, updates, value } = field({
    type: 'number',
    label: 'History',
    modelValue: 5,
    min: 1,
    max: 50,
  })
  const input = host.querySelector('input')!
  for (const invalid of ['51', '0', '2.5', '']) {
    await edit(input, invalid, 'change')
    expect(input.value).toBe('5')
  }
  expect(updates).not.toHaveBeenCalled()
  await edit(input, '12', 'input')
  expect(updates).not.toHaveBeenCalled()
  await edit(input, '12', 'change')
  expect(updates).toHaveBeenCalledExactlyOnceWith(12)
  expect(value.value).toBe(12)
})

it('commits an accessible keyboard slider adjustment and exposes its formatted value', async () => {
  const { host, updates } = field({
    type: 'range',
    label: 'Volume',
    modelValue: 5,
    min: 0,
    max: 100,
    step: 5,
    unit: '%',
  })
  await nextTick()
  const slider = host.querySelector<HTMLElement>('[role="slider"]')!
  expect(slider.getAttribute('aria-label')).toBe('Volume')
  slider.focus()
  slider.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
  await nextTick()
  expect(host.querySelector('output')?.textContent).toBe('10%')
  expect(slider.getAttribute('aria-valuetext')).toBe('10 %')
  await vi.waitFor(() => expect(updates).toHaveBeenCalledExactlyOnceWith(10))
})

it('uses Nuxt binary controls and never publishes edits to readonly fields', async () => {
  const enabled = field({ type: 'switch', label: 'Enabled', modelValue: false })
  await nextTick()
  const input = enabled.host.querySelector('[role="switch"]')!
  expect(input.getAttribute('aria-checked')).toBe('false')
  enabled.host.querySelector<HTMLLabelElement>('label')!.click()
  await nextTick()
  expect(enabled.updates).toHaveBeenCalledExactlyOnceWith(true)
  const readonly = field({
    type: 'textarea',
    label: 'Configuration',
    modelValue: 'Saved config',
    readonly: true,
    monospace: true,
  })
  const textarea = readonly.host.querySelector('textarea')!
  await edit(textarea, 'Changed', 'input')
  expect(textarea.value).toBe('Saved config')
  expect(readonly.updates).not.toHaveBeenCalled()
  expect(textarea.readOnly).toBe(true)
  expect(readonly.host.querySelector('.ui-setting-field--mono')).not.toBeNull()
})

it('selects Nuxt options and exposes accessible radio and checkbox groups with disabled options', async () => {
  const options = [
    { value: 'a', label: 'Alpha' },
    { value: 'b', label: 'Beta' },
    { value: 'c', label: 'Unavailable', disabled: true },
  ]
  const selected = field({ type: 'select', label: 'Language', modelValue: 'a', options })
  await nextTick()
  const select = selected.host.querySelector<HTMLButtonElement>('[role="combobox"]')!
  expect(selected.host.querySelector(`label[for="${select.id}"]`)?.textContent).toBe('Language')
  select.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
  await vi.waitFor(() => expect(document.querySelectorAll('[role="option"]')).toHaveLength(3))
  const selectOptions = [...document.querySelectorAll<HTMLElement>('[role="option"]')]
  expect(selectOptions[2]!.getAttribute('aria-disabled')).toBe('true')
  selectOptions[1]!.focus()
  selectOptions[1]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  await nextTick()
  await vi.waitFor(() => expect(selected.updates).toHaveBeenCalledExactlyOnceWith('b'))
  const radios = field({ type: 'radio', label: 'Method', modelValue: 'a', options })
  await nextTick()
  const radioInputs = radios.host.querySelectorAll<HTMLButtonElement>('[role="radio"]')
  expect(radios.host.querySelector('[role="radiogroup"]')?.getAttribute('aria-label')).toBe(
    'Method',
  )
  radioInputs[1]!.click()
  await nextTick()
  expect(radios.updates).toHaveBeenCalledExactlyOnceWith('b')
  expect(radioInputs[2]!.disabled).toBe(true)
  const multiple = field({ type: 'multiselect', label: 'Days', modelValue: ['a'], options })
  await nextTick()
  const checks = multiple.host.querySelectorAll<HTMLButtonElement>('[role="checkbox"]')
  expect(checks[2]!.disabled).toBe(true)
  checks[1]!.click()
  await nextTick()
  expect(multiple.value.value).toEqual(['a', 'b'])
  checks[0]!.click()
  await nextTick()
  expect(multiple.value.value).toEqual(['b'])
})

it('keeps plain text drafts until change when explicitly requested', async () => {
  const { host, value, updates } = field({ label: 'Project', modelValue: 'Old', commit: 'change' })
  const input = host.querySelector('input')!
  await edit(input, 'New', 'input')
  expect(updates).not.toHaveBeenCalled()
  expect(input.value).toBe('New')
  await edit(input, 'New', 'change')
  expect(value.value).toBe('New')
})

it('clears a reactive validation error after a committed text change', async () => {
  const value = ref('example')
  const updates = vi.fn((next: SettingValue) => {
    value.value = String(next)
  })
  const host = mount(
    {
      setup: () => () =>
        h(SettingField, {
          label: 'Contact email',
          modelValue: value.value,
          commit: 'change',
          error: value.value.includes('@') ? '' : 'Enter an email address containing @.',
          'onUpdate:modelValue': updates,
        }),
    },
    {},
  )
  const input = host.querySelector('input')!
  await nextTick()
  expect(input.getAttribute('aria-invalid')).toBe('true')
  await edit(input, 'demo@example.invalid', 'input')
  expect(updates).not.toHaveBeenCalled()
  await edit(input, 'demo@example.invalid', 'change')
  expect(updates).toHaveBeenCalledExactlyOnceWith('demo@example.invalid')
  expect(input.getAttribute('aria-invalid')).not.toBe('true')
  expect(host.querySelector('[role=alert]')).toBeNull()
})

it('provides named groups and non-submitting action buttons with a native busy state', () => {
  const host = mount(
    SettingGroup,
    { title: 'Notifications', description: 'Choose which messages appear' },
    () => h(UiButton, { busy: true, variant: 'primary' }, () => 'Save'),
  )
  const group = host.querySelector('section')!
  expect(host.querySelector(`#${group.getAttribute('aria-labelledby')}`)?.textContent).toBe(
    'Notifications',
  )
  const button = host.querySelector('button')!
  expect(button.type).toBe('button')
  expect(button.disabled).toBe(true)
  expect(button.getAttribute('aria-busy')).toBe('true')
  expect(button.dataset.variant).toBe('primary')
})

it('names settings sections without overriding an explicit accessible name', async () => {
  const host = mount(SettingSection, { title: 'Account', description: 'Choose a site' }, () =>
    h(SettingField, { label: 'Session', modelValue: '' }),
  )
  await nextTick()
  const section = host.querySelector('section')!
  expect(host.querySelector(`#${section.getAttribute('aria-labelledby')}`)?.textContent).toBe(
    'Account',
  )
  expect(host.querySelector('h3')?.textContent).toBe('Account')
  expect(host.querySelector('input')?.labels?.[0]?.textContent).toBe('Session')
  const named = mount(SettingSection, {
    title: 'China',
    'aria-label': 'China · leetcode.cn',
    level: 4,
  })
  expect(named.querySelector('section')?.getAttribute('aria-labelledby')).toBeNull()
  expect(named.querySelector('section')?.getAttribute('aria-label')).toBe('China · leetcode.cn')
  expect(named.querySelector('h4')?.textContent).toBe('China')
})

it('distinguishes persistent notes from live feedback and retains caller-owned status announcements', async () => {
  const tone = ref<'info' | 'error'>('info')
  const host = mount(
    {
      setup: () => () =>
        h(UiNotice, { tone: tone.value, title: 'Connection' }, () => 'Network unavailable'),
    },
    {},
  )
  expect(host.querySelector('.ui-notice')?.getAttribute('role')).toBe('note')
  expect(host.querySelector('.ui-notice [data-slot="title"]')?.textContent).toBe('Connection')
  tone.value = 'error'
  await nextTick()
  expect(host.querySelector('[role=alert]')?.textContent).toContain('Network unavailable')
  const overridden = mount(UiNotice, { tone: 'success', role: 'note' }, () => 'Saved')
  expect(overridden.querySelector('.ui-notice')?.getAttribute('role')).toBe('note')
  const status = mount(UiStatus, { tone: 'success' }, () => 'Signed in')
  expect(status.querySelector('[role]')).toBeNull()
  expect(status.querySelector('.ui-status')?.textContent).toBe('Signed in')
})
