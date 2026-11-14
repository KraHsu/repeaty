<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, shallowRef, watch } from 'vue'
import UPopover from '@nuxt/ui/components/Popover.vue'
import { UiButton } from './ui'
import { t } from '../i18n'
import type { MenuAction } from '../input/menus'

const props = defineProps<{
  boundary?: HTMLElement
  selectionKey: string
  selectionToken?: object
  actions: MenuAction[]
  opacity: number
  pointer?: { x: number; y: number }
}>()
const emit = defineEmits<{ choose: [action: MenuAction] }>()
const open = ref(false),
  toolbar = ref<HTMLElement>(),
  topInset = ref(8)
const reference = shallowRef<{ getBoundingClientRect(): DOMRect; contextElement: HTMLElement }>()
let range: Range | undefined,
  alive = true,
  frame = 0,
  keyboardOrigin: HTMLElement | undefined
let stopBoundary: (() => void) | undefined

function textareaRect(area: HTMLTextAreaElement) {
  const box = area.getBoundingClientRect(),
    style = getComputedStyle(area)
  const mirror = area.ownerDocument.createElement('div')
  mirror.setAttribute('aria-hidden', 'true')
  mirror.style.cssText =
    'position:fixed;visibility:hidden;pointer-events:none;white-space:pre-wrap;box-sizing:border-box;border:0;margin:0;height:auto;'
  for (const property of [
    'font-family',
    'font-size',
    'font-weight',
    'font-style',
    'font-variant',
    'line-height',
    'letter-spacing',
    'word-spacing',
    'tab-size',
    'text-indent',
    'text-transform',
    'word-break',
    'overflow-wrap',
    'padding-top',
    'padding-right',
    'padding-bottom',
    'padding-left',
  ])
    mirror.style.setProperty(property, style.getPropertyValue(property))
  mirror.style.width = `${area.clientWidth}px`
  mirror.style.left = `${box.left + area.clientLeft - area.scrollLeft}px`
  mirror.style.top = `${box.top + area.clientTop - area.scrollTop}px`
  const text = area.ownerDocument.createTextNode(area.value + '\u200b')
  mirror.append(text)
  area.ownerDocument.body.append(mirror)
  const selected = area.ownerDocument.createRange()
  try {
    selected.setStart(text, area.selectionStart)
    selected.setEnd(text, area.selectionEnd)
    return selected.getBoundingClientRect()
  } finally {
    selected.detach()
    mirror.remove()
  }
}
function snapshotAnchor() {
  range?.detach()
  range = undefined
  const boundary = props.boundary
  if (!boundary) return
  const selection = boundary.ownerDocument.getSelection()
  if (
    selection?.rangeCount &&
    !selection.isCollapsed &&
    boundary.contains(selection.anchorNode) &&
    boundary.contains(selection.focusNode)
  )
    range = selection.getRangeAt(0).cloneRange()
  const initial = boundary.getBoundingClientRect()
  const pointer = props.pointer && {
    x: props.pointer.x - initial.left,
    y: props.pointer.y - initial.top,
  }
  const area = boundary.querySelector('textarea')
  const selectedArea = area && area.selectionEnd > area.selectionStart ? area : undefined
  reference.value = {
    contextElement: boundary,
    getBoundingClientRect() {
      if (selectedArea?.isConnected) return textareaRect(selectedArea)
      if (range?.commonAncestorContainer.isConnected) return range.getBoundingClientRect()
      const mark = boundary.querySelector('mark')
      if (mark) return mark.getBoundingClientRect()
      const box = boundary.getBoundingClientRect()
      // Canvas-based plugins need no DOM selection API. Their pointer release
      // anchors the controls; keyboard-only plugins fall back to the reader edge.
      return new DOMRect(
        pointer ? box.left + pointer.x : box.left + box.width / 2,
        pointer ? box.top + pointer.y - 16 : Math.max(box.top, topInset.value + 8),
        1,
        pointer ? 24 : 1,
      )
    },
  }
}
function refresh() {
  if (!alive || frame) return
  frame = requestAnimationFrame(() => {
    frame = 0
    if (!alive || !props.boundary) return
    const titlebar = document.querySelector('.desktop-titlebar')?.getBoundingClientRect()
    topInset.value = Math.max(8, (titlebar?.bottom ?? 0) + 8)
    // A new reference identity makes Floating UI remeasure virtual ranges.
    if (reference.value) reference.value = { ...reference.value }
  })
}
function focusReader() {
  const target = keyboardOrigin?.isConnected
    ? keyboardOrigin
    : props.boundary?.querySelector<HTMLElement>('textarea, [tabindex="0"]')
  target?.focus({ preventScroll: true })
}
function enterToolbar(event: KeyboardEvent) {
  if (!open.value || event.key !== 'Tab' || event.shiftKey || event.isComposing) return
  const first = toolbar.value?.querySelector<HTMLButtonElement>('button:not(:disabled)')
  if (!first) return
  event.preventDefault()
  event.stopPropagation()
  keyboardOrigin = event.target as HTMLElement
  first.focus({ preventScroll: true })
}
function toolbarKeydown(event: KeyboardEvent) {
  const buttons = [
    ...(toolbar.value?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []),
  ]
  const index = buttons.indexOf(event.target as HTMLButtonElement)
  if (event.key === 'Escape' || (event.key === 'Tab' && event.shiftKey && index === 0)) {
    event.preventDefault()
    event.stopPropagation()
    open.value = false
    focusReader()
  } else if (event.key === 'Tab' && !event.shiftKey && index === buttons.length - 1) {
    // Reka's focus loop must not trap keyboard users in this non-modal toolbar.
    event.preventDefault()
    event.stopPropagation()
    open.value = false
    focusReader()
  } else if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) && index >= 0) {
    event.preventDefault()
    event.stopPropagation()
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? buttons.length - 1
          : (index + (event.key === 'ArrowLeft' ? -1 : 1) + buttons.length) % buttons.length
    buttons[next]?.focus({ preventScroll: true })
  }
}
const content = computed(() => ({
  side: 'bottom' as const,
  sideOffset: 8,
  align: 'start' as const,
  collisionPadding: { top: topInset.value, bottom: 8, left: 8, right: 8 },
  positionStrategy: 'fixed' as const,
  hideWhenDetached: true,
  'aria-label': t('选区工具栏'),
  onOpenAutoFocus: (event: Event) => event.preventDefault(),
  onCloseAutoFocus: (event: Event) => event.preventDefault(),
  onEscapeKeyDown: (event: Event) => {
    event.preventDefault()
    open.value = false
    if (toolbar.value?.contains(document.activeElement)) focusReader()
  },
}))
watch(
  () => props.boundary,
  (boundary) => {
    stopBoundary?.()
    if (!boundary) return
    boundary.addEventListener('keydown', enterToolbar)
    const observer = new ResizeObserver(refresh)
    observer.observe(boundary)
    const viewport = window.visualViewport
    window.addEventListener('resize', refresh)
    document.addEventListener('scroll', refresh, true)
    viewport?.addEventListener('resize', refresh)
    stopBoundary = () => {
      boundary.removeEventListener('keydown', enterToolbar)
      observer.disconnect()
      window.removeEventListener('resize', refresh)
      document.removeEventListener('scroll', refresh, true)
      viewport?.removeEventListener('resize', refresh)
    }
  },
  { immediate: true, flush: 'post' },
)
watch(
  () => [props.selectionKey, props.selectionToken, props.boundary, props.pointer] as const,
  async () => {
    open.value = false
    await nextTick()
    if (!alive || !props.selectionKey || !props.boundary || !props.actions.length) return
    snapshotAnchor()
    refresh()
    open.value = true
  },
  { immediate: true, flush: 'post' },
)
onUnmounted(() => {
  alive = false
  stopBoundary?.()
  range?.detach()
  if (frame) cancelAnimationFrame(frame)
})
</script>
<template>
  <UPopover
    :open="open && !!actions.length"
    :reference="reference"
    :content="content"
    :modal="false"
    :ui="{ content: 'reader-selection-popover' }"
    @update:open="open = $event"
  >
    <template #content>
      <div
        ref="toolbar"
        class="reader-selection-toolbar"
        role="toolbar"
        :aria-label="t('选区工具栏')"
        :style="{ opacity: opacity / 100 }"
        @mousedown.prevent
        @keydown="toolbarKeydown"
      >
        <UiButton
          v-for="action in actions"
          :key="action.id"
          variant="ghost"
          :disabled="action.disabled"
          @click="emit('choose', action)"
          >{{ action.title }}</UiButton
        >
      </div>
    </template>
  </UPopover>
</template>
<style>
.reader-selection-popover {
  width: min(36rem, calc(100vw - 1rem));
  max-width: calc(100vw - 1rem);
}
.reader-selection-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
  padding: 0.4rem;
  max-height: min(16rem, 42vh);
  overflow: auto;
}
.reader-selection-toolbar button {
  max-width: 100%;
  white-space: normal;
  overflow-wrap: anywhere;
}
</style>
