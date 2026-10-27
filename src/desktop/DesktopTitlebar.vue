<script setup lang="ts">
import { onMounted, onUnmounted, shallowRef } from 'vue'
import { Copy, Minus, Repeat2, Square, X } from '@lucide/vue'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useEventListener } from '@vueuse/core'
import { t } from '../i18n'
import { createWindowControls } from './window-controls'

const controls = createWindowControls(getCurrentWindow())
const { maximized, focused, failed } = controls
const modalHost = shallowRef<HTMLDialogElement>()
let observer: MutationObserver | undefined
let dialogs: HTMLDialogElement[] = []
function updateHost(records: MutationRecord[] = []) {
  const opened = [...document.querySelectorAll<HTMLDialogElement>('dialog[open]')]
  dialogs = dialogs.filter((dialog) => opened.includes(dialog))
  for (const { type, target } of records) {
    if (type === 'attributes' && target instanceof HTMLDialogElement) {
      dialogs = dialogs.filter((dialog) => dialog !== target)
      if (target.open && target.isConnected) dialogs.push(target)
    }
  }
  for (const dialog of opened) if (!dialogs.includes(dialog)) dialogs.push(dialog)
  // A modal makes the rest of the document inert. Keep the same titlebar instance
  // inside its top layer so window controls remain usable while editing.
  const focusedDialog = document.activeElement?.closest<HTMLDialogElement>('dialog[open]')
  modalHost.value = focusedDialog && opened.includes(focusedDialog) ? focusedDialog : dialogs.at(-1)
}
useEventListener(document, 'focusin', () => updateHost())
onMounted(() => {
  updateHost()
  observer = new MutationObserver(updateHost)
  observer.observe(document.body, {
    attributes: true,
    attributeFilter: ['open'],
    childList: true,
    subtree: true,
  })
  void controls.start()
})
onUnmounted(() => {
  observer?.disconnect()
  controls.dispose()
})
</script>

<template>
  <Teleport :to="modalHost ?? 'body'" :disabled="!modalHost">
    <div class="desktop-titlebar" :class="{ 'is-unfocused': !focused }">
      <div class="desktop-titlebar-drag" data-tauri-drag-region>
        <Repeat2 :size="16" :stroke-width="2" aria-hidden="true" />
        <span class="desktop-titlebar-name">Repeaty</span>
        <span v-if="failed" class="desktop-titlebar-error" role="alert">
          {{ t('窗口操作失败，请重试。') }}
        </span>
      </div>
      <div class="desktop-window-controls" role="group" :aria-label="t('窗口控制')">
        <button
          type="button"
          class="desktop-window-button"
          :aria-label="t('最小化窗口')"
          :title="t('最小化窗口')"
          @click="controls.run('minimize')"
        >
          <Minus :size="16" :stroke-width="1.5" aria-hidden="true" />
        </button>
        <button
          type="button"
          class="desktop-window-button"
          :aria-label="t(maximized ? '还原窗口' : '最大化窗口')"
          :title="t(maximized ? '还原窗口' : '最大化窗口')"
          @click="controls.run('toggleMaximize')"
        >
          <Copy v-if="maximized" :size="13" :stroke-width="1.5" aria-hidden="true" />
          <Square v-else :size="13" :stroke-width="1.5" aria-hidden="true" />
        </button>
        <button
          type="button"
          class="desktop-window-button desktop-window-close"
          :aria-label="t('关闭窗口')"
          :title="t('关闭窗口')"
          @click="controls.run('close')"
        >
          <X :size="17" :stroke-width="1.5" aria-hidden="true" />
        </button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.desktop-titlebar {
  position: fixed;
  inset: 0 0 auto;
  z-index: 50;
  height: var(--desktop-titlebar-height, 36px);
  display: flex;
  align-items: stretch;
  background: #f0f2ec;
  color: #405940;
  border-bottom: 1px solid #e2e6dc;
  user-select: none;
  -webkit-user-select: none;
}
.desktop-titlebar-drag {
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 0;
  gap: 8px;
  padding: 0 14px;
  cursor: default;
}
.desktop-titlebar-drag > * {
  pointer-events: none;
}
.desktop-titlebar-name {
  font-size: 0.8125rem;
  font-weight: 500;
  letter-spacing: 0.1px;
}
.desktop-titlebar-error {
  margin-left: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #a43d35;
  font-size: 0.8125rem;
}
.desktop-window-controls {
  display: flex;
  flex-shrink: 0;
}
.desktop-window-button {
  display: grid;
  place-items: center;
  width: 44px;
  height: 100%;
  padding: 0;
  border-radius: 0;
  cursor: default;
}
.desktop-window-button:hover {
  background: #dfe5d9;
}
.desktop-window-button:active {
  background: #d0dac8;
}
.desktop-window-button:focus-visible {
  outline: 2px solid var(--green);
  outline-offset: -4px;
}
.desktop-window-close:hover,
.desktop-window-close:active {
  color: #fff;
  background: #c9473e;
}
.desktop-window-close:focus-visible {
  outline-color: #a43d35;
}
.desktop-titlebar.is-unfocused {
  color: #869080;
}
.desktop-titlebar.is-unfocused .desktop-window-button:hover {
  color: #405940;
}
.desktop-titlebar.is-unfocused .desktop-window-close:hover {
  color: #fff;
}
</style>
