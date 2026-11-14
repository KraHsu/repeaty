<script setup lang="ts">
import { onErrorCaptured, type Component } from 'vue'
import type { MaterialCommandContext } from '@repeaty/plugin-api'
defineProps<{ component: Component; context: MaterialCommandContext; onClose: () => void }>()
const emit = defineEmits<{ failed: [] }>()
onErrorCaptured(() => {
  emit('failed')
  return false
})
</script>
<template><component :is="component" :context="context" :on-close="onClose" /></template>
