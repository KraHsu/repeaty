<script setup lang="ts">
withDefaults(defineProps<{ tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'busy' }>(), {
  tone: 'neutral',
})
</script>

<template>
  <span class="ui-status" :class="`ui-status--${tone}`"
    ><span class="ui-status__dot" aria-hidden="true" /><slot
  /></span>
</template>
