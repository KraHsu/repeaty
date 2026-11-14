<script setup lang="ts" generic="T extends string | number | null = string">
import { computed, ref, useAttrs } from 'vue'
import UInput from '@nuxt/ui/components/Input.vue'
defineOptions({ inheritAttrs: false })
const props = defineProps<{ modelValue?: T }>()
const emit = defineEmits<{ 'update:modelValue': [value: T] }>()
const attrs = useAttrs()
const component = ref<{ inputRef?: HTMLInputElement }>()
let composing = false
function update(value: string | number | null) {
  if (!composing) emit('update:modelValue', value as T)
}
function endComposition(event: CompositionEvent) {
  if (!composing) return
  composing = false
  // Match Vue's native v-model: flush the final composed value through Nuxt's
  // input handler, including its trim/number modifiers.
  event.target?.dispatchEvent(new Event('input', { bubbles: true }))
}
defineExpose({ inputRef: computed(() => component.value?.inputRef) })
</script>
<template>
  <UInput
    ref="component"
    v-bind="attrs"
    :model-value="props.modelValue"
    @update:model-value="update"
    @compositionstart="composing = true"
    @compositionend="endComposition"
  />
</template>
