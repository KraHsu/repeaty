// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, ref, type Component } from 'vue'
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

it('connects visible labels, help and errors to native controls without sharing generated ids', () => {
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
  const [input, second] = host.querySelectorAll('input')
  expect(input!.id).not.toBe(second!.id)
  expect(input!.labels?.[0]?.textContent).toBe('Display name')
  expect(input!.getAttribute('aria-invalid')).toBe('true')
  const described = input!.getAttribute('aria-describedby')!.split(' ')
  expect(described.map((id) => host.querySelector(`[id="${id}"]`)?.textContent)).toEqual([
    'Visible to you',
    'Required',
  ])
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

it('previews slider movement and submits only the finished value', async () => {
  const { host, updates } = field({
    type: 'range',
    label: 'Volume',
    modelValue: 5,
    min: 0,
    max: 100,
    step: 5,
    unit: '%',
  })
  const input = host.querySelector('input')!
  await edit(input, '35', 'input')
  expect(host.querySelector('output')?.textContent).toBe('35%')
  expect(input.getAttribute('aria-valuetext')).toBe('35 %')
  expect(updates).not.toHaveBeenCalled()
  await edit(input, '35', 'change')
  expect(updates).toHaveBeenCalledExactlyOnceWith(35)
})

it('uses native binary controls and never publishes edits to readonly fields', async () => {
  const enabled = field({ type: 'switch', label: 'Enabled', modelValue: false })
  const input = enabled.host.querySelector('input')!
  expect(input.getAttribute('role')).toBe('switch')
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

it('selects options and exposes native radio and checkbox groups with disabled options', async () => {
  const options = [
    { value: 'a', label: 'Alpha' },
    { value: 'b', label: 'Beta' },
    { value: 'c', label: 'Unavailable', disabled: true },
  ]
  const selected = field({ type: 'select', label: 'Language', modelValue: 'a', options })
  const select = selected.host.querySelector('select')!
  expect(select.labels?.[0]?.textContent).toBe('Language')
  await edit(select, 'b', 'change')
  expect(selected.updates).toHaveBeenCalledExactlyOnceWith('b')
  expect(select.options[2]!.disabled).toBe(true)
  const radios = field({ type: 'radio', label: 'Method', modelValue: 'a', options })
  const radioInputs = radios.host.querySelectorAll<HTMLInputElement>('input')
  expect(radios.host.querySelector('legend')!.textContent).toBe('Method')
  expect(radioInputs[0]!.name).toBe(radioInputs[1]!.name)
  radioInputs[1]!.click()
  await nextTick()
  expect(radios.updates).toHaveBeenCalledExactlyOnceWith('b')
  expect(radioInputs[2]!.disabled).toBe(true)
  const multiple = field({ type: 'multiselect', label: 'Days', modelValue: ['a'], options })
  const checks = multiple.host.querySelectorAll<HTMLInputElement>('input')
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
  expect(button.classList.contains('primary')).toBe(true)
})

it('names settings sections without overriding an explicit accessible name', () => {
  const host = mount(SettingSection, { title: 'Account', description: 'Choose a site' }, () =>
    h(SettingField, { label: 'Session', modelValue: '' }),
  )
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
  expect(host.querySelector('.ui-notice__title')?.textContent).toBe('Connection')
  tone.value = 'error'
  await nextTick()
  expect(host.querySelector('[role=alert]')?.textContent).toContain('Network unavailable')
  const overridden = mount(UiNotice, { tone: 'success', role: 'note' }, () => 'Saved')
  expect(overridden.querySelector('.ui-notice')?.getAttribute('role')).toBe('note')
  const status = mount(UiStatus, { tone: 'success' }, () => 'Signed in')
  expect(status.querySelector('[role]')).toBeNull()
  expect(status.querySelector('.ui-status')?.textContent).toBe('Signed in')
})
