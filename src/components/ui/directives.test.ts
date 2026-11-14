// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, ref, vModelText, withDirectives } from 'vue'
import { vUiButton, vUiControl, type UiButtonOptions } from './directives'

const cleanups: (() => void)[] = []
function mount(render: () => ReturnType<typeof h>) {
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp({ setup: () => render })
  app.mount(host)
  cleanups.push(() => {
    app.unmount()
    host.remove()
  })
  return host
}
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()))

it('retains the original textarea, selection, native v-model and IME composition', async () => {
  const value = ref('原生选区')
  const update = vi.fn((next: string) => {
    value.value = next
  })
  const host = mount(() =>
    withDirectives(
      h('textarea', {
        id: 'draft',
        'onUpdate:modelValue': update,
      }),
      [
        [vModelText, value.value],
        [vUiControl, { reading: true }],
      ],
    ),
  )
  const textarea = host.querySelector('textarea')!
  expect(textarea.classList.contains('ui-control--reading')).toBe(true)
  textarea.focus()
  textarea.setSelectionRange(1, 3)
  textarea.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
  textarea.value = '正在组字'
  textarea.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }))
  expect(update).not.toHaveBeenCalled()
  textarea.value = '已完成'
  textarea.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
  await nextTick()
  expect(value.value).toBe('已完成')
  expect(host.querySelector('textarea')).toBe(textarea)
  textarea.setSelectionRange(0, 2)
  await nextTick()
  expect([textarea.selectionStart, textarea.selectionEnd]).toEqual([0, 2])
})

it('keeps native submit, readonly and disabled semantics without intercepting events', () => {
  const click = vi.fn()
  const host = mount(() =>
    h('form', [
      withDirectives(h('button', { class: 'primary', onClick: click }, 'Save'), [[vUiButton]]),
      withDirectives(h('input', { readonly: true, value: 'copy me' }), [[vUiControl]]),
      h('fieldset', { disabled: true }, [
        withDirectives(h('input', { type: 'checkbox' }), [[vUiControl]]),
      ]),
    ]),
  )
  const button = host.querySelector('button')!
  expect(button.getAttribute('type')).toBeNull()
  expect(button.type).toBe('submit')
  expect(button.classList.contains('ui-button--primary')).toBe(true)
  button.dispatchEvent(new MouseEvent('click'))
  expect(click).toHaveBeenCalledOnce()
  expect(host.querySelector('input')!.readOnly).toBe(true)
  expect(host.querySelector('fieldset')!.disabled).toBe(true)
  expect((host.querySelector('fieldset input') as HTMLInputElement).disabled).toBe(false)
})

it('updates action variants without deleting business classes or replacing DOM nodes', async () => {
  const style = ref<UiButtonOptions>({ variant: 'rating', tone: 'again' })
  const host = mount(() =>
    withDirectives(h('button', { class: 'grade-button again' }, 'Again'), [
      [vUiButton, style.value],
    ]),
  )
  const button = host.querySelector('button')!
  expect(button.classList.contains('ui-button--again')).toBe(true)
  style.value = { variant: 'ghost', icon: true }
  await nextTick()
  expect(host.querySelector('button')).toBe(button)
  expect(button.classList.contains('ui-button--again')).toBe(false)
  expect(button.classList.contains('ui-button--icon')).toBe(true)
  expect(button.classList.contains('again')).toBe(true)
  expect(button.classList.contains('grade-button')).toBe(true)
})

it('classifies selection, file and progress primitives while leaving hidden pickers and disclosures native', () => {
  const host = mount(() =>
    h('div', [
      ...['checkbox', 'radio', 'range', 'file', 'hidden'].map((type) =>
        withDirectives(h('input', { type }), [[vUiControl]]),
      ),
      withDirectives(h('input', { type: 'file', class: 'sr-only' }), [[vUiControl]]),
      withDirectives(h('progress', { value: 25, max: 100 }), [[vUiControl]]),
      withDirectives(h('input', { type: 'radio' }), [[vUiControl, { swatch: true }]]),
      h('details', [withDirectives(h('summary', {}, 'History'), [[vUiButton, 'ghost']])]),
    ]),
  )
  for (const type of ['checkbox', 'radio', 'range', 'file'])
    expect(
      host.querySelector(`input[type=${type}]`)!.classList.contains(`ui-control--${type}`),
    ).toBe(true)
  expect(host.querySelector('input[type=hidden]')!.className).toBe('')
  expect(host.querySelector('.sr-only')!.classList.contains('ui-control')).toBe(false)
  expect(host.querySelector('progress')!.value).toBe(25)
  expect(host.querySelector('progress')!.classList.contains('ui-control--progress')).toBe(true)
  expect(host.querySelector('.ui-control--swatch')).not.toBeNull()
  expect(host.querySelector('summary')!.tagName).toBe('SUMMARY')
})
