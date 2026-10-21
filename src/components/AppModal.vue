<script setup lang="ts">
import { t } from '../i18n'

import { onMounted, ref, useId } from 'vue'
import { X } from '@lucide/vue'
import { isTextEditing } from '../shortcuts'

const props = defineProps<{ title: string; busy?: boolean; error?: string; wide?: boolean }>()
const emit = defineEmits<{ close: [] }>()
const dialog = ref<HTMLDialogElement>()
let outsidePointer: number | undefined
function outside(event: PointerEvent) {
  const bounds = dialog.value?.getBoundingClientRect()
  return (
    event.target === dialog.value &&
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
  const form = dialog.value?.querySelector('form')
  if (!form || (isTextEditing(event) && event.target instanceof HTMLSelectElement)) return
  const submit = form.querySelector<HTMLButtonElement>('button[type="submit"], button:not([type])')
  if (submit?.disabled) return
  event.preventDefault()
  form.requestSubmit()
}
// Several modals can coexist (editor over history); a fixed id would point every
// aria-labelledby at the first heading in the document.
const titleId = `${useId()}-title`
onMounted(() => dialog.value?.showModal())
</script>

<template>
  <dialog
    ref="dialog"
    class="modal"
    :class="{ 'modal-wide': wide }"
    :aria-labelledby="titleId"
    @cancel.prevent="!busy && emit('close')"
    @pointerdown="pointerDown"
    @pointerup="pointerUp"
    @pointercancel="outsidePointer = undefined"
    @keydown="keydown"
  >
    <div class="modal-content">
      <header class="modal-header">
        <h2 :id="titleId">{{ title }}</h2>
        <button
          class="icon-button"
          :aria-label="t('关闭弹窗')"
          :disabled="busy"
          @click="emit('close')"
        >
          <X :size="20" />
        </button>
      </header>
      <p v-if="error" class="import-warning" role="alert">{{ error }}</p>
      <slot />
    </div>
  </dialog>
</template>
