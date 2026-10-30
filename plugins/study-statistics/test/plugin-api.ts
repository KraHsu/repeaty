import { defineComponent, h, ref } from 'vue'
import { vi } from 'vitest'
import type {
  StudyStatisticsDetails,
  StudyStatisticsDetailsQuery,
  StudyStatisticsQuery,
  StudyStatisticsSnapshot,
} from '@repeaty/plugin-api'

export const locale = ref('zh-CN')
export const registerPage = vi.fn()
export const study = {
  statistics:
    vi.fn<
      (query: StudyStatisticsQuery, signal?: AbortSignal) => Promise<StudyStatisticsSnapshot>
    >(),
  statisticsDetails:
    vi.fn<
      (query: StudyStatisticsDetailsQuery, signal?: AbortSignal) => Promise<StudyStatisticsDetails>
    >(),
  subscribe: vi.fn<(_: () => void) => () => void>(() => () => {}),
}
export const AppPage = defineComponent({
  props: ['title', 'description'],
  setup:
    (props, { slots }) =>
    () =>
      h('main', [h('h1', props.title), slots.actions?.(), slots.default?.()]),
})
export const UiButton = defineComponent({
  props: ['disabled', 'busy', 'variant', 'icon'],
  setup:
    (props, { attrs, slots }) =>
    () =>
      h('button', { ...attrs, disabled: props.disabled || props.busy }, slots.default?.()),
})
export const UiSelect = defineComponent({
  props: ['modelValue', 'items'],
  emits: ['update:modelValue'],
  setup:
    (props, { emit, attrs }) =>
    () =>
      h(
        'select',
        {
          ...attrs,
          value: props.modelValue,
          onChange: (event: Event) =>
            emit('update:modelValue', (event.target as HTMLSelectElement).value),
        },
        props.items?.map((entry: { label: string; value: string }) =>
          h('option', { value: entry.value }, entry.label),
        ),
      ),
})
export const UiNotice = defineComponent({
  setup:
    (_, { slots }) =>
    () =>
      h('aside', [slots.default?.(), slots.actions?.()]),
})
export const UiStatus = defineComponent({
  setup:
    (_, { slots }) =>
    () =>
      h('span', slots.default?.()),
})
