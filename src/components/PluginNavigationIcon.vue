<script setup lang="ts">
import { onErrorCaptured, ref, watch, type Component } from 'vue'
import { Puzzle } from '@lucide/vue'
const props = defineProps<{ component?: Component }>()
const failed = ref(false)
onErrorCaptured(() => {
  failed.value = true
  return false
})
watch(
  () => props.component,
  () => {
    failed.value = false
  },
)
</script>
<template>
  <component :is="failed ? Puzzle : (component ?? Puzzle)" :size="22" :width="22" :height="22" />
</template>
