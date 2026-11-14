<script setup lang="ts">
import { computed } from 'vue'
import { appearance, type MaterialIcon } from '../appearance'
const props = withDefaults(
  defineProps<{
    state?: 'pending' | 'scheduled' | 'archived'
    size?: number
    preview?: MaterialIcon
    kind?: 'reading' | 'review'
  }>(),
  { state: 'pending', size: 16 },
)
const settings = computed(
  () =>
    props.preview ??
    (props.kind === 'review' ? appearance.reviewIcons : appearance.materialIcons)[props.state],
)
const paths: Record<string, string> = {
  document: 'M6 3H14L19 8V21H5V3Z M14 3V8H19 M8 12H16 M8 16H16',
  leaf: 'M4 20C2 8 7 3 21 3C21 17 16 22 4 20Z M4 20L16 8',
  hexagon: 'M7 3H17L22 12L17 21H7L2 12Z',
  diamond: 'M12 2L22 12L12 22L2 12Z',
  circle: 'M12 2A10 10 0 1 1 12 22A10 10 0 1 1 12 2Z',
  square: 'M3 3H21V21H3Z',
  triangle: 'M12 3L22 21H2Z',
}
const path = computed(() =>
  settings.value.shape === 'custom'
    ? settings.value.path || paths.document
    : paths[settings.value.shape],
)
</script>
<template>
  <svg
    class="material-state-icon"
    viewBox="0 0 24 24"
    :width="size * settings.scale"
    :height="size * settings.scale"
    :style="{ color: settings.color || 'currentColor', opacity: settings.opacity }"
    aria-hidden="true"
    fill="none"
    stroke="currentColor"
    stroke-linejoin="round"
    stroke-linecap="round"
  >
    <path :d="path" :stroke-width="settings.lineWidth" />
    <path
      v-if="settings.doubleLine"
      :d="path"
      :stroke-width="settings.innerWidth"
      :transform="`translate(${12 * (1 - settings.innerScale)} ${12 * (1 - settings.innerScale)}) scale(${settings.innerScale})`"
    />
  </svg>
</template>
<style scoped>
.material-state-icon {
  flex-shrink: 0;
  overflow: visible;
}
</style>
