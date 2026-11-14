<script setup lang="ts">
import { computed, onBeforeUnmount, onErrorCaptured, type Component } from 'vue'
import type { MaterialReaderProps } from '@repeaty/plugin-api'
const props = defineProps<{ component: Component; readerProps: MaterialReaderProps }>()
const emit = defineEmits<{ failed: [] }>()
let alive = true
onErrorCaptured(() => {
  if (alive) emit('failed')
  return false
})
onBeforeUnmount(() => {
  alive = false
})
const guarded = computed<MaterialReaderProps>(() => ({
  ...props.readerProps,
  onSelect: (value) => {
    if (alive) props.readerProps.onSelect(value)
  },
  onPosition: (value) => {
    if (alive) props.readerProps.onPosition?.(value)
  },
}))
</script>
<template><component :is="component" v-bind="guarded" /></template>
