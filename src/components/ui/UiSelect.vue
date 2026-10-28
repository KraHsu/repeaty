<script setup lang="ts" generic="T extends string | number | boolean = string">
import { computed, useAttrs } from 'vue'
import USelect from '@nuxt/ui/components/Select.vue'
defineOptions({ inheritAttrs: false })
const props = defineProps<{
  modelValue?: T
  items?: readonly { label: string; value: T | null; disabled?: boolean }[]
}>()
const emit = defineEmits<{ 'update:modelValue': [value: T]; change: [event: Event] }>()
const attrs = useAttrs()
// Reka reserves the empty string for an unselected trigger. Our public/legacy
// setting values legitimately use it for “all”, so adapt it at the UI boundary.
const options = computed<
  { label: string; value: string | number | boolean | null; disabled?: boolean }[] | undefined
>(() =>
  props.items?.map((item) => ({
    ...item,
    value: item.value === '' ? null : item.value,
  })),
)
const selected = computed<string | number | boolean | null | undefined>(() =>
  props.modelValue === '' ? null : props.modelValue,
)
function update(value: unknown) {
  const actual = (value === null ? '' : value) as T
  emit('update:modelValue', actual)
  const event = new Event('change', { bubbles: true })
  Object.defineProperty(event, 'target', { value: { value: actual } })
  emit('change', event)
}
</script>
<template>
  <USelect
    v-bind="attrs"
    :items="options"
    :model-value="selected"
    :value="props.modelValue == null ? '' : String(props.modelValue)"
    @update:model-value="update"
  >
    <template #item-label="{ item }"
      ><span :data-select-value="item.value == null ? '' : String(item.value)">{{
        item.label
      }}</span></template
    >
  </USelect>
</template>
