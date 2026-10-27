<script setup lang="ts">
import { computed, onMounted, ref, shallowRef, watch } from 'vue'
import { useEventListener, useResizeObserver } from '@vueuse/core'
import { useNotifications } from '../notifications'
import { popupEnabled } from '../preferences'
import NotificationToast from './NotificationToast.vue'
const { notifications } = useNotifications()

const floating = computed(() => notifications.value.filter((entry) => popupEnabled(entry.level)))
const inline = computed(() => notifications.value.filter((entry) => !popupEnabled(entry.level)))
const top = ref(90)
const header = shallowRef<HTMLElement | null>(null)
function position() {
  if (!notifications.value.length) return
  const bottom = document.querySelector('.topbar')?.getBoundingClientRect().bottom ?? 78
  top.value = Math.min(Math.max(16, bottom + 12), innerHeight * 0.35)
}
watch(notifications, position, { flush: 'post' })
onMounted(() => {
  header.value = document.querySelector<HTMLElement>('.topbar')
})
useResizeObserver(header, position)
useEventListener(window, 'resize', position)
useEventListener(window, 'scroll', position, { passive: true, capture: true })
</script>
<template>
  <div v-if="floating.length" class="notification-center" :style="{ top: `${top}px` }">
    <NotificationToast v-for="entry in floating" :key="entry.id" :entry="entry" />
  </div>
  <div v-if="inline.length" class="inline-notifications">
    <NotificationToast v-for="entry in inline" :key="entry.id" :entry="entry" inline />
  </div>
</template>
<style>
.notification-center {
  position: fixed;
  z-index: 1100;
  top: 90px;
  left: calc(50% + 115px);
  transform: translateX(-50%);
  width: min(620px, calc(100vw - 36px));
  max-height: 50dvh;
  overflow: auto;
  display: grid;
  gap: 0.65rem;
  pointer-events: none;
}
.notification {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  border: 1px solid #cedac7;
  padding: 0.8rem 1rem;
  background: #f4f8ef;
  color: #365b42;
  border-radius: 10px;
  box-shadow: 0 8px 28px #20351b1c;
  font-size: var(--font-size-body);
  line-height: var(--line-height-ui);
  pointer-events: auto;
}
.notification > svg {
  flex-shrink: 0;
}
.notification > span {
  flex: 1;
  overflow-wrap: anywhere;
}
.notification .icon-button {
  flex-shrink: 0;
}
.notification.warning {
  background: #fff8e8;
  border-color: #e2c894;
  color: #775612;
}
.notification.error {
  background: #fff1ec;
  border-color: #e8bba9;
  color: #914c36;
}
.inline-notifications {
  display: grid;
  gap: 0.65rem;
  margin: 1rem 2rem;
}
.inline-notification {
  box-shadow: none;
}
@media (max-width: 1200px) {
  .notification-center {
    left: calc(50% + 102px);
  }
}
@media (max-width: 980px) {
  .notification-center {
    left: calc(50% + 92px);
  }
}
@media (max-width: 720px) {
  .notification-center {
    left: 50%;
    top: 82px;
  }
  .inline-notifications {
    margin: 1rem;
  }
}
</style>
