import { defineComponent, h } from 'vue'
import { vi } from 'vitest'
export const registerCommand = vi.fn(),
  registerImporter = vi.fn(),
  registerReader = vi.fn()
export const materials = { snapshot: vi.fn(), get: vi.fn(), original: vi.fn(), createNote: vi.fn() }
export const UiNotice = defineComponent({
  setup: (_, context) => () => h('aside', context.slots.default?.()),
})
export const UiButton = defineComponent({
  props: ['disabled', 'busy'],
  setup:
    (props, { slots, attrs }) =>
    () =>
      h('button', { ...attrs, disabled: props.disabled || props.busy }, slots.default?.()),
})
export const SettingField = defineComponent({
  props: ['modelValue', 'options', 'type', 'label', 'disabled', 'maxlength'],
  emits: ['update:modelValue'],
  setup:
    (props, { emit }) =>
    () =>
      h('label', [
        props.label,
        h(
          props.type === 'select' ? 'select' : 'input',
          {
            value: props.modelValue,
            type: props.type,
            disabled: props.disabled,
            onChange: (event: Event) =>
              emit('update:modelValue', (event.target as HTMLInputElement).value),
          },
          props.type === 'select'
            ? props.options?.map((item: { value: string; label: string }) =>
                h('option', { value: item.value }, item.label),
              )
            : undefined,
        ),
      ]),
})
