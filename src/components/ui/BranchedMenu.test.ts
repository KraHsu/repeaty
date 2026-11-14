// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, ref, type App } from 'vue'
import type { SettingsCategoryNode } from '../../settings/types'
import BranchedMenu from './BranchedMenu.vue'
import { flattenBranchedMenu, menuAncestors, visibleMenuRows } from './branched-menu'

// These tests exercise Repeaty's tree controller and ownership. Nuxt UI's
// real button / collapsible primitives are exercised by the browser regressions.
vi.mock('@nuxt/ui/components/Button.vue', async () => {
  const { defineComponent, h } = await import('vue')
  return {
    default: defineComponent({
      inheritAttrs: false,
      props: ['color', 'variant', 'icon', 'ui'],
      setup:
        (_, { attrs, slots }) =>
        () =>
          h('button', attrs, slots.default?.()),
    }),
  }
})
vi.mock('@nuxt/ui/components/Collapsible.vue', async () => {
  const { defineComponent, h } = await import('vue')
  return {
    default: defineComponent({
      props: { open: Boolean, unmountOnHide: Boolean, ui: Object },
      setup:
        (props, { slots }) =>
        () =>
          h('div', { class: props.ui?.root, 'data-state': props.open ? 'open' : 'closed' }, [
            h(
              'div',
              {
                class: props.ui?.content,
                hidden: !props.open,
                'data-state': props.open ? 'open' : 'closed',
              },
              slots.content?.(),
            ),
          ]),
    }),
  }
})

const observers: {
  callback: () => void
  observe: ReturnType<typeof vi.fn>
  unobserve: ReturnType<typeof vi.fn>
  disconnect: ReturnType<typeof vi.fn>
}[] = []
const cleanups: (() => void)[] = []
let sequence = 0
function node(key: string, children: SettingsCategoryNode[] = []): SettingsCategoryNode {
  return { key, title: key, children, entries: [] }
}
function categories() {
  return [
    node('general', [node('general.appearance'), node('general.notifications')]),
    node('study', [
      node('study.review', [
        node('study.review.history', [node('study.review.history.detail', [node('too-deep')])]),
      ]),
    ]),
    node('connections', [node('connections.leetcode')]),
    node('workspace'),
  ]
}
function mount(selected = 'general') {
  const host = document.createElement('div')
  document.body.append(host)
  const items = ref(categories())
  const value = ref(selected)
  const updates = vi.fn((key: string) => {
    value.value = key
  })
  const id = `menu-${++sequence}`
  const app: App = createApp({
    setup: () => () =>
      h(BranchedMenu, {
        items: items.value,
        modelValue: value.value,
        label: 'Settings categories',
        idPrefix: id,
        controls: `${id}-content`,
        'onUpdate:modelValue': updates,
      }),
  })
  app.mount(host)
  let alive = true
  const stop = () => {
    if (!alive) return
    alive = false
    app.unmount()
    host.remove()
  }
  cleanups.push(stop)
  const row = (key: string) =>
    [...host.querySelectorAll<HTMLButtonElement>('[data-category-key]')].find(
      (element) => element.dataset.categoryKey === key,
    )!
  return { host, items, value, updates, row, stop }
}
async function key(element: HTMLElement, value: string) {
  element.dispatchEvent(
    new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true }),
  )
  await nextTick()
  await nextTick()
}
beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn()
      unobserve = vi.fn()
      disconnect = vi.fn()
      constructor(callback: () => void) {
        observers.push({
          callback,
          observe: this.observe,
          unobserve: this.unobserve,
          disconnect: this.disconnect,
        })
      }
    },
  )
})
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup())
  observers.splice(0)
  vi.unstubAllGlobals()
})

it('roves visible rows without selecting until Enter or Space and follows tree arrow semantics', async () => {
  const menu = mount()
  await nextTick()
  menu.row('general').focus()
  await key(menu.row('general'), 'ArrowDown')
  expect(document.activeElement).toBe(menu.row('general.appearance'))
  expect(menu.value.value).toBe('general')
  await key(menu.row('general.appearance'), 'Enter')
  expect(menu.value.value).toBe('general.appearance')
  await key(menu.row('general.appearance'), 'Home')
  expect(document.activeElement).toBe(menu.row('general'))
  await key(menu.row('general'), 'ArrowLeft')
  expect(menu.row('general').getAttribute('aria-expanded')).toBe('false')
  await key(menu.row('general'), 'ArrowDown')
  expect(document.activeElement).toBe(menu.row('study'))
  await key(menu.row('study'), 'ArrowRight')
  expect(menu.row('study').getAttribute('aria-expanded')).toBe('true')
  await key(menu.row('study'), 'ArrowRight')
  expect(document.activeElement).toBe(menu.row('study.review'))
  await key(menu.row('study.review'), 'ArrowLeft')
  expect(document.activeElement).toBe(menu.row('study'))
  await key(menu.row('study'), 'End')
  expect(document.activeElement).toBe(menu.row('workspace'))
  await key(menu.row('workspace'), ' ')
  expect(menu.value.value).toBe('workspace')
  expect(menu.host.querySelectorAll('[role=treeitem][tabindex="0"]')).toHaveLength(1)
})

it('keeps parent aggregation separate from disclosure and labels its controlled content', async () => {
  const menu = mount()
  const general = menu.row('general')
  const toggle = menu.host.querySelector<HTMLButtonElement>('.branched-menu__toggle')!
  toggle.click()
  await nextTick()
  expect(general.getAttribute('aria-expanded')).toBe('false')
  expect(menu.updates).not.toHaveBeenCalled()
  general.click()
  await nextTick()
  expect(general.getAttribute('aria-expanded')).toBe('true')
  expect(menu.updates).toHaveBeenLastCalledWith('general')
  expect(general.tagName).toBe('BUTTON')
  expect(general.getAttribute('role')).toBe('treeitem')
  expect(general.getAttribute('aria-controls')).toMatch(/-content$/)
  const group = document.getElementById(general.getAttribute('aria-owns')!)!
  expect(group.getAttribute('role')).toBe('group')
  expect(toggle.getAttribute('aria-label')).toContain('general')
  expect(toggle.getAttribute('tabindex')).toBe('-1')
  expect(menu.row('general.appearance').getAttribute('title')).toBe('general.appearance')
})

it('opens external selections, bounds nesting and recovers removed focus without stealing input focus', async () => {
  const menu = mount()
  const input = document.createElement('input')
  menu.host.append(input)
  input.focus()
  menu.value.value = 'study.review.history.detail'
  await nextTick()
  await nextTick()
  expect(document.activeElement).toBe(input)
  for (const key of ['study', 'study.review', 'study.review.history'])
    expect(menu.row(key).getAttribute('aria-expanded')).toBe('true')
  expect(menu.row('study.review.history.detail').getAttribute('aria-level')).toBe('4')
  expect(menu.row('too-deep')).toBeUndefined()
  menu.row('study.review.history.detail').focus()
  menu.items.value = [node('general', [node('general.appearance')]), node('workspace')]
  await nextTick()
  await nextTick()
  expect(document.activeElement).toBe(menu.row('general'))
  expect(menu.row('study')).toBeUndefined()
  expect(menu.host.querySelectorAll('[role=treeitem][tabindex="0"]')).toHaveLength(1)
})

it('owns observers and navigation state per instance and releases removed groups and stale callbacks', async () => {
  const first = mount(),
    second = mount('connections.leetcode')
  await nextTick()
  expect(observers).toHaveLength(2)
  first.host.querySelector<HTMLButtonElement>('.branched-menu__toggle')!.click()
  await nextTick()
  expect(first.row('general').getAttribute('aria-expanded')).toBe('false')
  expect(second.row('general').getAttribute('aria-expanded')).toBe('true')
  first.items.value = [node('workspace')]
  await nextTick()
  expect(observers[0]!.unobserve).toHaveBeenCalled()
  first.stop()
  expect(observers[0]!.disconnect).toHaveBeenCalledOnce()
  expect(observers[1]!.disconnect).not.toHaveBeenCalled()
  expect(() => observers[0]!.callback()).not.toThrow()
  second.row('connections.leetcode').focus()
  await key(second.row('connections.leetcode'), 'ArrowLeft')
  expect(document.activeElement).toBe(second.row('connections'))
})

it('keeps category ancestry and visibility independent from rendering', () => {
  const rows = flattenBranchedMenu(categories())
  expect(menuAncestors(rows, 'study.review.history.detail')).toEqual([
    'study',
    'study.review',
    'study.review.history',
  ])
  expect(visibleMenuRows(rows, new Set()).map((row) => row.node.key)).toEqual([
    'general',
    'study',
    'connections',
    'workspace',
  ])
})
