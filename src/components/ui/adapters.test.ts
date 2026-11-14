// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, ref } from 'vue'
import UiInput from './UiInput.vue'
import UiTextarea from './UiTextarea.vue'
import UiSelect from './UiSelect.vue'

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

for (const [name, component] of [
  ['input', UiInput],
  ['textarea', UiTextarea],
] as const) {
  it(`keeps ${name} composition local and exposes the native editing surface`, async () => {
    const value = ref('before')
    const editor = ref<{ inputRef?: HTMLInputElement; textareaRef?: HTMLTextAreaElement }>()
    const host = document.createElement('div')
    document.body.append(host)
    const app = createApp({
      render: () =>
        h(component, {
          ref: editor,
          modelValue: value.value,
          'onUpdate:modelValue': (next: string | number | null) => {
            value.value = String(next)
          },
          'aria-label': 'Editor',
        }),
    })
    app.mount(host)
    cleanups.push(() => {
      app.unmount()
      host.remove()
    })
    await nextTick()
    const native = host.querySelector<HTMLInputElement | HTMLTextAreaElement>(name)!
    expect(editor.value?.[name === 'input' ? 'inputRef' : 'textareaRef']).toBe(native)
    native.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    native.value = '组'
    native.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }))
    await nextTick()
    expect(value.value).toBe('before')
    native.value = '组合完成'
    native.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
    await nextTick()
    expect(value.value).toBe('组合完成')
    native.focus()
    native.setSelectionRange(1, 3)
    expect([native.selectionStart, native.selectionEnd]).toEqual([1, 3])
  })
}

it('adapts the all-items empty value and emits the selected domain value to change handlers', async () => {
  const value = ref('')
  const changed: string[] = []
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp({
    render: () =>
      h(UiSelect, {
        modelValue: value.value,
        items: [
          { label: 'All', value: '' },
          { label: 'One', value: 'one' },
        ],
        'onUpdate:modelValue': (next: string | number | boolean) => {
          value.value = String(next)
        },
        onChange: (event: Event) => changed.push((event.target as HTMLInputElement).value),
        'aria-label': 'Filter',
      }),
  })
  app.mount(host)
  cleanups.push(() => {
    app.unmount()
    host.remove()
  })
  await nextTick()
  const trigger = host.querySelector<HTMLButtonElement>('[role=combobox]')!
  expect(trigger.value).toBe('')
  expect(trigger.textContent).toContain('All')
  trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
  await vi.waitFor(() => expect(document.querySelectorAll('[role=option]')).toHaveLength(2))
  const one = document
    .querySelector('[data-select-value=one]')
    ?.closest<HTMLElement>('[role=option]')
  expect(one).not.toBeNull()
  one!.focus()
  one!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  await nextTick()
  await vi.waitFor(() => expect(value.value).toBe('one'))
  expect(changed).toEqual(['one'])
})
