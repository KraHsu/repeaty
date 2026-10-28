<script setup lang="ts">
import { computed } from 'vue'
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
</script>

<template>
  <div class="ui-notice" :class="`ui-notice--${tone}`" :role="role">
    <svg
      class="ui-notice__icon"
      width="18"
      height="18"
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="10" cy="10" r="8" stroke="currentColor" stroke-width="1.5" />
      <path
        v-if="tone === 'success'"
        d="m6 10 2.5 2.5L14 7"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <template v-else>
        <path
          :d="tone === 'info' ? 'M10 9v5' : 'M10 6v5'"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
        />
        <circle cx="10" :cy="tone === 'info' ? 6 : 14" r="1" fill="currentColor" />
      </template>
    </svg>
    <div class="ui-notice__body">
      <p v-if="title" class="ui-notice__title">{{ title }}</p>
      <div class="ui-notice__content"><slot /></div>
    </div>
    <div v-if="$slots.actions" class="ui-notice__actions"><slot name="actions" /></div>
  </div>
</template>
