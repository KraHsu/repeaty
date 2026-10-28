<script setup lang="ts">
import UiButton from './UiButton.vue'
withDefaults(defineProps<{ label: string; title?: string; disabled?: boolean; busy?: boolean }>(), {
  disabled: false,
  busy: false,
})
</script>
<template>
  <UiButton
    variant="ghost"
    icon
    :aria-label="label"
    :title="title ?? label"
    :disabled="disabled"
    :busy="busy"
    ><slot
  /></UiButton>
</template>
