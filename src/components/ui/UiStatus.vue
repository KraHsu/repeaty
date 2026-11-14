<script setup lang="ts">
import { computed } from 'vue'
import UBadge from '@nuxt/ui/components/Badge.vue'
const props = withDefaults(
  defineProps<{ tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'busy' }>(),
  {
    tone: 'neutral',
  },
)
const color = computed(() =>
  props.tone === 'danger' ? 'error' : props.tone === 'busy' ? 'info' : props.tone,
)
</script>
<template>
  <UBadge :color="color" variant="soft" class="ui-status"><slot /></UBadge>
</template>
