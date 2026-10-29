import { defineComponent, h, ref } from 'vue'
import { vi } from 'vitest'
export const locale = ref('zh-CN')
export const readSetting = vi.fn(() => null),
  writeSetting = vi.fn()
export const registerPage = vi.fn(),
  registerSettings = vi.fn()
export const tasks = { run: vi.fn() }
export const materials = { snapshot: vi.fn(), get: vi.fn(), editContent: vi.fn() }
export const AppPage = defineComponent({
  setup:
    (_, { slots }) =>
    () =>
      h('main', [slots.actions?.(), slots.default?.()]),
})
export const UiButton = defineComponent({
  props: ['disabled', 'busy'],
  setup:
    (props, { slots, attrs }) =>
    () =>
      h('button', { ...attrs, disabled: props.disabled }, slots.default?.()),
})
export const UiNotice = defineComponent({
  setup:
    (_, { slots }) =>
    () =>
      h('aside', slots.default?.()),
})
export const UiTextarea = defineComponent({
  props: ['modelValue'],
  setup:
    (props, { attrs }) =>
    () =>
      h('textarea', { ...attrs, value: props.modelValue }),
})
export const SettingField = defineComponent({
  props: ['modelValue', 'options'],
  emits: ['update:modelValue'],
  setup:
    (props, { emit }) =>
    () =>
      h(
        'select',
        {
          value: props.modelValue,
          onChange: (event: Event) =>
            emit('update:modelValue', (event.target as HTMLSelectElement).value),
        },
        props.options?.map((item: { value: string; label: string }) =>
          h('option', { value: item.value }, item.label),
        ),
      ),
})
export const SettingSection = AppPage
