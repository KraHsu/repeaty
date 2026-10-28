<script setup lang="ts">
import { vUiButton, type UiButtonVariant, type UiButtonTone } from './directives'
withDefaults(
  defineProps<{
    variant?: UiButtonVariant
    tone?: UiButtonTone
    icon?: boolean
    type?: 'button' | 'submit' | 'reset'
    disabled?: boolean
    busy?: boolean
  }>(),
  { variant: 'secondary', type: 'button' },
)
</script>

<template>
  <button
    v-ui-button="{ variant, tone, icon }"
    :type="type"
    :class="['button', 'ui-button', variant]"
    :disabled="disabled || busy"
    :aria-busy="busy || undefined"
  >
    <slot />
  </button>
</template>
