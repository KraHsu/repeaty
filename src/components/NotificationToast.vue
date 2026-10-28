<script setup lang="ts">
import { vUiButton } from './ui'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { X, Info, TriangleAlert, CircleAlert } from '@lucide/vue'
import { t } from '../i18n'
import { useNotifications, type Notification } from '../notifications'
const { dismissNotification } = useNotifications()

const props = defineProps<{ entry: Notification; inline?: boolean }>()
const icon = computed(() =>
  props.entry.level === 'error'
    ? CircleAlert
    : props.entry.level === 'warning'
      ? TriangleAlert
      : Info,
)
let timer: ReturnType<typeof setTimeout> | undefined
let remaining = 5000,
  started = 0
const hovering = ref(false),
  focused = ref(false)
function pause() {
  if (timer) remaining = Math.max(0, remaining - (Date.now() - started))
  clearTimeout(timer)
  timer = undefined
}
function resume() {
  if (props.entry.level !== 'info' || hovering.value || focused.value || timer) return
  started = Date.now()
  timer = setTimeout(() => dismissNotification(props.entry.id), remaining)
}
function pointerIn() {
  hovering.value = true
  pause()
}
function pointerOut() {
  hovering.value = false
  resume()
}
function focusIn() {
  focused.value = true
  pause()
}
function focusOut() {
  focused.value = false
  resume()
}
onMounted(resume)
onUnmounted(pause)
</script>
<template>
  <div
    :class="['notification', entry.level, { 'inline-notification': inline }]"
    :role="entry.level === 'info' ? 'status' : 'alert'"
    @mouseenter="pointerIn"
    @mouseleave="pointerOut"
    @focusin="focusIn"
    @focusout="focusOut"
  >
    <component :is="icon" :size="20" aria-hidden="true" />
    <span>{{ t(entry.text) }}</span>
    <button
      v-ui-button="{ variant: 'ghost', icon: true }"
      class="icon-button"
      :aria-label="t('关闭提示')"
      @click="dismissNotification(entry.id)"
    >
      <X :size="18" />
    </button>
  </div>
</template>
