// @vitest-environment happy-dom
import { createApp, h, nextTick, reactive, ref } from 'vue'
import { afterEach, expect, it, vi } from 'vitest'
import AppModal from './AppModal.vue'
import UDropdownMenu from '@nuxt/ui/components/DropdownMenu.vue'

const cleanups: (() => void)[] = []
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()))
async function settle() {
  await nextTick()
  await new Promise((resolve) => setTimeout(resolve, 0))
  await nextTick()
}
async function mountModal(busy = false, form = false) {
  const host = document.createElement('div')
  document.body.append(host)
  const props = reactive({ busy })
  const close = vi.fn()
  const submit = vi.fn((event: Event) => event.preventDefault())
  const app = createApp({
    render: () =>
      h(AppModal, { title: 'Modal protocol', ...props, onClose: close }, () =>
        form
          ? h('form', { onSubmit: submit }, [
              h('textarea'),
              h('button', { type: 'button', role: 'combobox' }, 'Choose'),
              h('button', { type: 'submit' }, 'Save'),
            ])
          : h('p', 'Body'),
      ),
  })
  app.mount(host)
  cleanups.push(() => {
    app.unmount()
    host.remove()
  })
  await settle()
  const layer = document.querySelector<HTMLElement>('[data-app-modal-content]')!
  const panel = layer.querySelector<HTMLElement>('.app-modal-panel')!
  vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue({
    left: 100,
    right: 500,
    top: 100,
    bottom: 400,
  } as DOMRect)
  return { props, close, submit, layer, panel }
}
function pointer(target: HTMLElement, type: string, id: number, x = 20, y = 20, extra = {}) {
  target.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      pointerId: id,
      isPrimary: true,
      button: 0,
      clientX: x,
      clientY: y,
      ...extra,
    }),
  )
}

it('dismisses only a matching primary outside press and release and respects busy changes', async () => {
  const { layer, panel, props, close } = await mountModal()
  expect(layer.getAttribute('role')).toBe('dialog')
  expect(layer.getAttribute('aria-modal')).toBe('true')
  pointer(panel, 'pointerdown', 1, 200, 200)
  pointer(layer, 'pointerup', 1)
  pointer(layer, 'pointerdown', 2)
  pointer(panel, 'pointerup', 2, 200, 200)
  pointer(layer, 'pointerdown', 3)
  pointer(layer, 'pointerup', 4)
  pointer(layer, 'pointerdown', 5)
  pointer(layer, 'pointercancel', 5)
  pointer(layer, 'pointerup', 5)
  pointer(layer, 'pointerdown', 6, 20, 20, { button: 2 })
  pointer(layer, 'pointerup', 6)
  expect(close).not.toHaveBeenCalled()
  pointer(layer, 'pointerdown', 7)
  props.busy = true
  await nextTick()
  pointer(layer, 'pointerup', 7)
  props.busy = false
  await nextTick()
  pointer(layer, 'pointerdown', 8)
  pointer(layer, 'pointerup', 8)
  expect(close).toHaveBeenCalledTimes(1)
})

it('keeps save shortcuts and busy Escape under application control', async () => {
  const { layer, props, close, submit } = await mountModal(true, true)
  layer.dispatchEvent(
    new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Escape' }),
  )
  expect(close).not.toHaveBeenCalled()
  props.busy = false
  await nextTick()
  layer.dispatchEvent(
    new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Escape',
      isComposing: true,
    }),
  )
  const legacyIme = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Escape' })
  Object.defineProperty(legacyIme, 'keyCode', { value: 229 })
  layer.dispatchEvent(legacyIme)
  expect(close).not.toHaveBeenCalled()
  const input = layer.querySelector('textarea')!
  input.dispatchEvent(
    new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter', ctrlKey: true }),
  )
  expect(submit).toHaveBeenCalledTimes(1)
  layer.querySelector('[role="combobox"]')!.dispatchEvent(
    new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Enter',
      ctrlKey: true,
    }),
  )
  expect(submit).toHaveBeenCalledTimes(1)
  input.dispatchEvent(
    new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Enter',
      ctrlKey: true,
      isComposing: true,
    }),
  )
  expect(submit).toHaveBeenCalledTimes(1)
  layer.dispatchEvent(
    new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Escape' }),
  )
  expect(close).toHaveBeenCalledTimes(1)
})

it('closes only the top nested modal with Escape and restores focus into its parent', async () => {
  const host = document.createElement('div')
  document.body.append(host)
  const nested = ref(false)
  const outerClose = vi.fn()
  const app = createApp({
    render: () =>
      h(AppModal, { title: 'Parent', onClose: outerClose }, () => [
        h(
          'button',
          {
            id: 'nested-modal-trigger',
            onClick: () => {
              nested.value = true
            },
          },
          'Open child',
        ),
        nested.value
          ? h(
              AppModal,
              {
                title: 'Child',
                onClose: () => {
                  nested.value = false
                },
              },
              () => h('input'),
            )
          : null,
      ]),
  })
  app.mount(host)
  cleanups.push(() => {
    app.unmount()
    host.remove()
  })
  await settle()
  const trigger = document.getElementById('nested-modal-trigger')!
  trigger.focus()
  trigger.click()
  await settle()
  const layers = document.querySelectorAll<HTMLElement>('[data-app-modal-content]')
  expect(layers).toHaveLength(2)
  layers[1]!.dispatchEvent(
    new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Escape' }),
  )
  await settle()
  expect(nested.value).toBe(false)
  expect(outerClose).not.toHaveBeenCalled()
  expect(document.activeElement).toBe(trigger)
})

it('restores a surviving menu trigger when selecting a menu item opens an editor', async () => {
  const host = document.createElement('div')
  document.body.append(host)
  const open = ref(false)
  const app = createApp({
    render: () => [
      h(
        UDropdownMenu,
        {
          items: [
            {
              label: 'Edit',
              onSelect: () => {
                open.value = true
              },
            },
          ],
        },
        () => h('button', { id: 'menu-editor-trigger' }, 'Actions'),
      ),
      open.value
        ? h(
            AppModal,
            {
              title: 'Editor',
              onClose: () => {
                open.value = false
              },
            },
            () => h('textarea'),
          )
        : null,
    ],
  })
  app.mount(host)
  cleanups.push(() => {
    app.unmount()
    host.remove()
  })
  await settle()
  const trigger = document.getElementById('menu-editor-trigger')!
  trigger.focus()
  trigger.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }),
  )
  await settle()
  const item = document.querySelector<HTMLElement>('[role="menuitem"]')!
  expect(item).not.toBeNull()
  item.focus()
  item.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
  )
  await settle()
  const layer = document.querySelector<HTMLElement>('[data-app-modal-content]')!
  expect(layer).not.toBeNull()
  layer.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
  )
  await settle()
  expect(open.value).toBe(false)
  expect(document.activeElement).toBe(trigger)
})
