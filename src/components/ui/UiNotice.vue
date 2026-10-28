<script setup lang="ts">
import { computed } from 'vue'
import UAlert from '@nuxt/ui/components/Alert.vue'
const props = withDefaults(
  defineProps<{
    tone?: 'info' | 'success' | 'warning' | 'error'
    title?: string
  }>(),
  { tone: 'info' },
)
const role = computed(() =>
  props.tone === 'error' ? 'alert' : props.tone === 'success' ? 'status' : 'note',
)
const icon = computed(
  () =>
    ({
      info: 'i-lucide-info',
      success: 'i-lucide-circle-check',
      warning: 'i-lucide-triangle-alert',
      error: 'i-lucide-circle-alert',
    })[props.tone],
)
</script>
<template>
  <UAlert :title="title" :color="tone" :icon="icon" variant="soft" :role="role" class="ui-notice">
    <template #description><slot /></template>
    <template v-if="$slots.actions" #actions><slot name="actions" /></template>
  </UAlert>
</template>
