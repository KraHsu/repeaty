<script setup lang="ts">
import { computed } from 'vue'
import UButton from '@nuxt/ui/components/Button.vue'
import type { UiButtonVariant, UiButtonTone } from './directives'
const props = withDefaults(
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
const color = computed(() =>
  props.variant === 'rating'
    ? ({ again: 'error', hard: 'warning', good: 'success', easy: 'info' } as const)[
        props.tone ?? 'good'
      ]
    : props.variant === 'danger'
      ? 'error'
      : props.variant === 'primary'
        ? 'primary'
        : 'neutral',
)
const appearance = computed(() =>
  props.variant === 'rating'
    ? 'soft'
    : props.variant === 'ghost'
      ? 'ghost'
      : props.variant === 'secondary'
        ? 'outline'
        : 'solid',
)
</script>

<template>
  <UButton
    :type="type"
    :color="color"
    :variant="appearance"
    :square="icon"
    :loading="busy"
    class="ui-button"
    :class="{
      'flex-col items-stretch text-left': variant === 'rating',
      'min-w-11 justify-center': icon,
    }"
    :data-variant="variant"
    :data-tone="tone"
    :disabled="disabled || busy"
    :aria-busy="busy || undefined"
  >
    <slot />
  </UButton>
</template>
