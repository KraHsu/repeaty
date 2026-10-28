<script setup lang="ts" generic="T extends string | number | null = string">
import { computed, ref, useAttrs } from 'vue'
import UTextarea from '@nuxt/ui/components/Textarea.vue'
defineOptions({ inheritAttrs: false })
const props = defineProps<{ modelValue?: T }>()
const emit = defineEmits<{ 'update:modelValue': [value: T] }>()
const attrs = useAttrs()
const component = ref<{ textareaRef?: HTMLTextAreaElement }>()
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
defineExpose({ textareaRef: computed(() => component.value?.textareaRef) })
</script>
<template>
  <UTextarea
    ref="component"
    v-bind="attrs"
    :rows="attrs.rows === undefined ? undefined : Number(attrs.rows)"
    :model-value="props.modelValue"
    @update:model-value="update"
    @compositionstart="composing = true"
    @compositionend="endComposition"
  />
</template>
