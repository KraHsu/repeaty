import { defineComponent, h, ref } from 'vue'
import { vi } from 'vitest'
export const locale = ref('zh-CN')
export const resources = { read: vi.fn() }
export const materials = {
  list: vi.fn(async () => []),
  get: vi.fn(),
  setSequence: vi.fn(),
  snapshot: vi.fn(() => ({ revision: 1 })),
}
export const tasks = { run: vi.fn() }
const control = defineComponent({
  inheritAttrs: false,
  setup(_, { attrs, slots }) {
    return () => h('button', attrs, slots.default?.())
  },
})
export const UiButton = control,
  UiCollapsible = control,
  UiSelect = control
export const UiInput = defineComponent({
  setup(_, { attrs }) {
    return () => h('input', attrs)
  },
})
export const UiNotice = defineComponent({
  setup(_, { slots }) {
    return () => h('aside', slots.default?.())
  },
})
