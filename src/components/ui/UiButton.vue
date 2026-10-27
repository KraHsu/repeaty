<script setup lang="ts">
withDefaults(
  defineProps<{
    variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
    type?: 'button' | 'submit' | 'reset'
    disabled?: boolean
    busy?: boolean
  }>(),
  { variant: 'secondary', type: 'button' },
)
</script>

<template>
  <button
    :type="type"
    :class="['button', 'ui-button', variant]"
    :disabled="disabled || busy"
    :aria-busy="busy || undefined"
  >
    <slot />
  </button>
</template>
