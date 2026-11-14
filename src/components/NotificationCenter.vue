<script setup lang="ts">
import { computed, onMounted, ref, shallowRef, watch } from 'vue'
import { useEventListener, useMutationObserver, useResizeObserver } from '@vueuse/core'
import { useNotifications } from '../notifications'
import { popupEnabled } from '../preferences'
import NotificationToast from './NotificationToast.vue'
const { notifications } = useNotifications()

const floating = computed(() => notifications.value.filter((entry) => popupEnabled(entry.level)))
const inline = computed(() => notifications.value.filter((entry) => !popupEnabled(entry.level)))
const top = ref(16)
const center = shallowRef<{ $el: HTMLElement } | null>(null)
const surface = shallowRef<HTMLElement | null>(null)
const boundaries = shallowRef<HTMLElement[]>([])
function dismissing(element: Element) {
  // A fading toast has already been dismissed; it must not remain an interactive
  // or announced duplicate while the visual exit finishes.
  element.setAttribute('inert', '')
  element.setAttribute('aria-hidden', 'true')
}
function position() {
  if (!notifications.value.length) return
  const frame = Math.max(
    0,
    boundaries.value
      .find((element) => element.matches('.desktop-titlebar'))
      ?.getBoundingClientRect().bottom ?? 0,
  )
  let nextTop = frame + 16
  for (const element of boundaries.value) {
    if (element.matches('.desktop-titlebar')) continue
    const rect = element.getBoundingClientRect()
    // A partly scrolled-out heading still owns its visible actions. Moving a
    // toast over them between pointer down and up would steal the click.
    if (
      rect.width > 0 &&
      rect.height > 0 &&
      rect.bottom > frame &&
      rect.top < window.innerHeight &&
      rect.right > 0 &&
      rect.left < window.innerWidth &&
      getComputedStyle(element).visibility !== 'hidden'
    )
      nextTop = Math.max(nextTop, rect.bottom + 12)
  }
  top.value = nextTop
}
function refreshBoundaries() {
  if (!notifications.value.length) return
  const current = [
    ...(surface.value?.querySelectorAll<HTMLElement>(
      '.desktop-titlebar, .topbar, .app-page-header',
    ) ?? []),
  ]
  if (
    current.length !== boundaries.value.length ||
    current.some((element, index) => element !== boundaries.value[index])
  )
    boundaries.value = current
  position()
}
watch(notifications, refreshBoundaries, { flush: 'post' })
onMounted(() => {
  surface.value = center.value?.$el.closest<HTMLElement>('.app-layout') ?? document.body
  refreshBoundaries()
})
useMutationObserver(
  surface,
  (records) => {
    if (
      records.some(
        ({ target }) =>
          target instanceof Element &&
          !target.closest('.notification-center, .inline-notifications'),
      )
    )
      refreshBoundaries()
  },
  { childList: true, subtree: true },
)
useResizeObserver(boundaries, position)
useEventListener(window, 'resize', position)
useEventListener(window, 'scroll', position, { passive: true, capture: true })
</script>
<template>
  <TransitionGroup
    ref="center"
    tag="div"
    name="notification-toast"
    class="notification-center"
    :style="{ top: `${top}px` }"
    @before-leave="dismissing"
  >
    <NotificationToast v-for="entry in floating" :key="entry.id" :entry="entry" />
  </TransitionGroup>
  <div v-if="inline.length" class="inline-notifications">
    <NotificationToast v-for="entry in inline" :key="entry.id" :entry="entry" inline />
  </div>
</template>
<style>
.notification-center {
  position: fixed;
  /* Application dialogs own their surface; background toasts must not cover
     modal headings or remain visually actionable above an inert background. */
  z-index: 900;
  top: 16px;
  right: 24px;
  width: min(440px, calc(100vw - 48px));
  max-height: 50dvh;
  overflow: auto;
  display: grid;
  gap: 0.65rem;
  pointer-events: none;
}
.notification {
  pointer-events: auto;
}
.notification.info {
  --notification-tone: var(--ui-info);
}
.notification.warning {
  --notification-tone: var(--ui-warning);
}
.notification.error {
  --notification-tone: var(--ui-error);
}
.notification-center > .notification {
  /* A floating message needs an opaque surface so underlying page text cannot
     show through the semantic tint provided by UAlert's soft variant. */
  background: color-mix(in srgb, var(--notification-tone) 8%, var(--ui-bg));
  border: 1px solid color-mix(in srgb, var(--notification-tone) 25%, var(--ui-bg));
  box-shadow: 0 8px 30px #243c3118;
}
.notification-toast-enter-active,
.notification-toast-leave-active {
  transition:
    opacity 180ms,
    transform 180ms;
}
.notification-toast-enter-from,
.notification-toast-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}
.notification > svg {
  flex-shrink: 0;
}
.notification [data-slot='description'] {
  overflow-wrap: anywhere;
}
.notification .icon-button {
  flex-shrink: 0;
}
.inline-notifications {
  display: grid;
  gap: 0.65rem;
  margin: 1rem 2rem;
}
.inline-notification {
  box-shadow: none;
}
@media (max-width: 720px) {
  .notification-center {
    right: 16px;
    width: calc(100vw - 32px);
  }
  .inline-notifications {
    margin: 1rem;
  }
}
</style>
