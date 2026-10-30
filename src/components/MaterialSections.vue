<script setup lang="ts">
import { onBeforeUnmount, onMounted, onUpdated, ref } from 'vue'
import { t } from '../i18n'
import { UiButton } from './ui'
defineProps<{
  modelValue: 'library' | 'inbox' | 'connections'
  inboxCount: number
  connections?: boolean
  disabled?: boolean
}>()
const emit = defineEmits<{ 'update:modelValue': [value: 'library' | 'inbox' | 'connections'] }>()
const navigation = ref<HTMLElement>(),
  indicator = ref<HTMLElement>()
let observer: ResizeObserver | undefined
function position() {
  const nav = navigation.value,
    background = indicator.value
  const active = nav?.querySelector<HTMLElement>('button[aria-pressed="true"]')
  if (!nav || !background || !active?.offsetWidth) return
  const first = !background.hasAttribute('data-visible')
  if (first) background.style.transition = 'none'
  background.style.transform = `translateX(${active.offsetLeft}px)`
  background.style.width = `${active.offsetWidth}px`
  background.style.height = `${active.offsetHeight}px`
  background.setAttribute('data-visible', '')
  if (first) {
    void background.offsetHeight
    background.style.transition = ''
  }
}
onMounted(() => {
  observer = new ResizeObserver(position)
  if (navigation.value) {
    observer.observe(navigation.value)
    navigation.value.querySelectorAll('button').forEach((button) => observer!.observe(button))
  }
  position()
})
onUpdated(position)
onBeforeUnmount(() => observer?.disconnect())
</script>
<template>
  <nav ref="navigation" class="material-sections" :aria-label="t('材料工作区')">
    <span ref="indicator" class="material-section-indicator" aria-hidden="true" />
    <UiButton
      variant="ghost"
      :aria-pressed="modelValue === 'library'"
      :disabled="disabled"
      @click="emit('update:modelValue', 'library')"
      >{{ t('阅读材料') }}</UiButton
    >
    <UiButton
      variant="ghost"
      :aria-pressed="modelValue === 'inbox'"
      :disabled="disabled"
      @click="emit('update:modelValue', 'inbox')"
      >{{ t('收件箱')
      }}<span v-if="inboxCount" class="material-section-count">{{ inboxCount }}</span></UiButton
    >
    <UiButton
      v-if="connections"
      variant="ghost"
      :aria-pressed="modelValue === 'connections'"
      :disabled="disabled"
      @click="emit('update:modelValue', 'connections')"
      >{{ t('来源') }}</UiButton
    >
  </nav>
</template>
<style scoped>
.material-sections {
  position: relative;
  display: flex;
  align-items: center;
  width: fit-content;
  max-width: 100%;
  gap: 0.25rem;
  margin-bottom: 1.5rem;
}
.material-sections > button {
  position: relative;
  z-index: 1;
  background: transparent;
}
.material-sections > button[aria-pressed='true'] {
  color: var(--app-nav-ink);
}
.material-section-indicator {
  position: absolute;
  left: 0;
  top: 0;
  background: var(--app-selected);
  border-radius: var(--app-radius);
  pointer-events: none;
  visibility: hidden;
  transition:
    transform 200ms cubic-bezier(0.2, 0.8, 0.2, 1),
    width 200ms cubic-bezier(0.2, 0.8, 0.2, 1);
}
.material-section-indicator[data-visible] {
  visibility: visible;
}
.material-section-count {
  font-size: var(--font-size-meta);
  font-variant-numeric: tabular-nums;
}
@media (prefers-reduced-motion: reduce) {
  .material-section-indicator {
    transition: none;
  }
}
</style>
