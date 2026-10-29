<script setup lang="ts">
import UModal from '@nuxt/ui/components/Modal.vue'
import UCard from '@nuxt/ui/components/Card.vue'
import UAlert from '@nuxt/ui/components/Alert.vue'
import { UiButton } from './ui'
import { t } from '../i18n'

import { computed, nextTick, ref, useId } from 'vue'
import { X } from '@lucide/vue'
import { isTextEditing } from '../shortcuts'

const props = defineProps<{ title: string; busy?: boolean; error?: string; wide?: boolean }>()
const emit = defineEmits<{ close: [] }>()
const panel = ref<HTMLElement>()
// AppModal is controlled by its parent rather than a DialogTrigger. Reka's
// default close handler only restores a registered trigger, so retain the
// actual opener for editors and nested application dialogs.
function modalOpener() {
  let element = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
  const visited = new Set<HTMLElement>()
  // Menu items disappear when selection opens an editor. Restore the menu's
  // surviving trigger (also walking out of submenus), rather than that item.
  while (element && !visited.has(element)) {
    visited.add(element)
    const menu = element.closest('[role="menu"]')
    if (!menu?.id) break
    const trigger = [...document.querySelectorAll<HTMLElement>('[aria-controls]')].find(
      (candidate) => candidate.getAttribute('aria-controls')?.split(/\s+/).includes(menu.id),
    )
    if (!trigger) break
    element = trigger
  }
  return element
}
const opener = modalOpener()
function restoreFocus(event: Event) {
  event.preventDefault()
  void nextTick(() => {
    if (opener?.isConnected) opener.focus({ preventScroll: true })
  })
}
let outsidePointer: number | undefined
function outside(event: PointerEvent) {
  const layer = panel.value?.closest('[data-app-modal-content]')
  const bounds = panel.value?.getBoundingClientRect()
  return (
    event.target === layer &&
    bounds &&
    (event.clientX < bounds.left ||
      event.clientX > bounds.right ||
      event.clientY < bounds.top ||
      event.clientY > bounds.bottom)
  )
}
function pointerDown(event: PointerEvent) {
  outsidePointer =
    !props.busy && event.isPrimary && event.button === 0 && outside(event)
      ? event.pointerId
      : undefined
}
function pointerUp(event: PointerEvent) {
  const close = outsidePointer === event.pointerId && outside(event)
  outsidePointer = undefined
  if (close && !props.busy) emit('close')
}
function cancelPointer() {
  outsidePointer = undefined
}
function keydown(event: KeyboardEvent) {
  if (
    event.defaultPrevented ||
    event.repeat ||
    event.isComposing ||
    event.keyCode === 229 ||
    event.key !== 'Enter' ||
    !(event.ctrlKey || event.metaKey) ||
    event.altKey ||
    event.shiftKey ||
    props.busy
  )
    return
  // Only forms get the save shortcut. Destructive confirmations still require
  // their explicit button, and a nested editor can handle the chord first.
  const form = panel.value?.querySelector('form')
  if (!form || (isTextEditing(event) && event.target instanceof HTMLSelectElement)) return
  if (
    event
      .composedPath()
      .some(
        (target) =>
          target instanceof HTMLElement && target.matches('[role="combobox"], [role="listbox"]'),
      )
  )
    return
  const submit = form.querySelector<HTMLButtonElement>('button[type="submit"], button:not([type])')
  if (submit?.disabled) return
  event.preventDefault()
  form.requestSubmit()
}
// Several modals can coexist (editor over history); a fixed id would point every
// aria-labelledby at the first heading in the document.
const titleId = `${useId()}-title`
function escape(event: KeyboardEvent) {
  event.preventDefault()
  event.stopPropagation()
  outsidePointer = undefined
  if (!props.busy && !event.isComposing && event.keyCode !== 229) emit('close')
}
const modalContent = computed(() => ({
  'data-app-modal-content': '',
  'aria-labelledby': titleId,
  'aria-modal': true,
  onPointerdown: pointerDown,
  onPointerup: pointerUp,
  onPointercancel: cancelPointer,
  onKeydown: keydown,
  onEscapeKeyDown: escape,
  onCloseAutoFocus: restoreFocus,
}))
</script>

<template>
  <UModal
    :open="true"
    :close="false"
    :dismissible="false"
    :transition="false"
    fullscreen
    :content="modalContent"
    :ui="{ content: 'app-modal-layer', overlay: 'app-modal-overlay' }"
  >
    <template #content>
      <div ref="panel" class="app-modal-panel" :class="{ 'app-modal-panel-wide': wide }">
        <UCard class="modal-content" :ui="{ body: 'app-modal-body' }">
          <template #header>
            <header class="modal-header">
              <h2 :id="titleId">{{ title }}</h2>
              <UiButton
                variant="ghost"
                icon
                :aria-label="t('关闭弹窗')"
                :disabled="busy"
                @click="emit('close')"
              >
                <X :size="20" />
              </UiButton>
            </header>
          </template>
          <UAlert
            v-if="error"
            class="import-warning"
            role="alert"
            color="error"
            :description="error"
          />
          <slot />
          <template v-if="$slots.footer" #footer><slot name="footer" /></template>
        </UCard>
      </div>
    </template>
  </UModal>
</template>

<style>
/* A native top-layer dialog opened by external code owns its pointer scope,
   even while Reka locks pointer events on the surrounding document body. */
dialog:modal {
  pointer-events: auto;
}
.app-modal-layer {
  z-index: 1000;
  display: flex;
  flex-direction: row;
  align-items: safe center;
  justify-content: center;
  overflow-y: auto;
  padding: 1rem;
  background: transparent;
  box-shadow: none;
  transform: none;
}
.app-modal-overlay {
  z-index: 1000;
}
.app-modal-layer:has(> .desktop-titlebar) {
  top: var(--desktop-titlebar-height, 36px);
  height: calc(100dvh - var(--desktop-titlebar-height, 36px));
}
.app-modal-panel {
  width: min(640px, 100%);
  max-height: calc(100dvh - 2rem);
  min-width: 0;
  flex-shrink: 0;
}
.app-modal-layer:has(> .desktop-titlebar) .app-modal-panel {
  max-height: calc(100dvh - var(--desktop-titlebar-height, 36px) - 2rem);
}
.app-modal-panel-wide {
  width: min(1080px, 100%);
}
.app-modal-panel .modal-content {
  padding: 0;
  display: flex;
  flex-direction: column;
  max-height: inherit;
  overflow: hidden;
}
.app-modal-panel .modal-content > [data-slot='header'],
.app-modal-panel .modal-content > [data-slot='footer'] {
  flex: 0 0 auto;
}
.app-modal-body {
  min-height: 0;
  overflow-y: auto;
}
.app-modal-body:has(> .note-editor) {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 0;
}
.app-modal-body > .note-editor {
  flex: 1;
}
.app-modal-panel .modal-header {
  margin: 0;
}
</style>
