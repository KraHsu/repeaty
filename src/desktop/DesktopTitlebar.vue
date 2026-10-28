<script setup lang="ts">
import { UiButton } from '../components/ui'
import { onMounted, onUnmounted, shallowRef, watch } from 'vue'
import { Copy, Minus, Repeat2, Square, X } from '@lucide/vue'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useEventListener } from '@vueuse/core'
import { t } from '../i18n'
import { createWindowControls } from './window-controls'
import { createSnapRegionController, nativeSnapDriver, snapRegion } from './snap-layout'

const appWindow = getCurrentWindow()
const controls = createWindowControls(appWindow)
const { maximized, focused, failed } = controls
const maximizeButton = shallowRef<InstanceType<typeof UiButton>>()
const maximizeElement = () => maximizeButton.value?.$el as HTMLButtonElement | undefined
const snap = createSnapRegionController(nativeSnapDriver(appWindow), () => {
  const button = maximizeElement()
  return button?.isConnected
    ? snapRegion(button.getBoundingClientRect(), window.innerWidth, window.innerHeight)
    : null
})
const { enabled: snapEnabled, hovered: nativeHovered, pressed: nativePressed } = snap
let active = false,
  frame: number | undefined,
  forceGeometry = false
let geometryObserver: ResizeObserver | undefined
const nativeStops: (() => void | Promise<void>)[] = []
function requestGeometry(force = false) {
  if (!active) return
  forceGeometry ||= force
  if (frame !== undefined) return
  frame = requestAnimationFrame(() => {
    frame = undefined
    const force = forceGeometry
    forceGeometry = false
    if (active) void snap.sync(force)
  })
}
function stopGeometry() {
  active = false
  if (frame !== undefined) cancelAnimationFrame(frame)
  frame = undefined
  geometryObserver?.disconnect()
  for (const stop of nativeStops.splice(0)) {
    try {
      void Promise.resolve(stop()).catch(() => {})
    } catch {
      /* Window closed. */
    }
  }
  void snap.dispose()
}
function ownNative(registration: Promise<() => void | Promise<void>>) {
  void registration
    .then((stop) => {
      if (active) nativeStops.push(stop)
      else void Promise.resolve(stop()).catch(() => {})
    })
    .catch(() => {})
}
const modalHost = shallowRef<HTMLElement>()
let observer: MutationObserver | undefined
let dialogs: HTMLElement[] = []
const modalSelector = 'dialog[open], [data-app-modal-content]'
function updateHost(records: MutationRecord[] = []) {
  const opened = [...document.querySelectorAll<HTMLElement>(modalSelector)]
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
  const focusedDialog = document.activeElement?.closest<HTMLElement>(modalSelector)
  modalHost.value = focusedDialog && opened.includes(focusedDialog) ? focusedDialog : dialogs.at(-1)
}
useEventListener(document, 'focusin', () => updateHost())
useEventListener(window, 'resize', () => requestGeometry(true))
useEventListener(window, 'scroll', () => requestGeometry(), { capture: true, passive: true })
useEventListener(window.visualViewport, 'resize', () => requestGeometry(true))
useEventListener(window.visualViewport, 'scroll', () => requestGeometry(true))
useEventListener(window, 'pagehide', stopGeometry)
watch(modalHost, () => requestGeometry(true), { flush: 'post' })
onMounted(() => {
  active = true
  updateHost()
  observer = new MutationObserver(updateHost)
  observer.observe(document.body, {
    attributes: true,
    attributeFilter: ['open'],
    childList: true,
    subtree: true,
  })
  void controls.start()
  geometryObserver = new ResizeObserver(() => requestGeometry())
  const button = maximizeElement()
  if (button) geometryObserver.observe(button)
  geometryObserver.observe(document.documentElement)
  ownNative(appWindow.onResized(() => requestGeometry(true)))
  ownNative(appWindow.onScaleChanged(() => requestGeometry(true)))
  ownNative(appWindow.listen('window-snap-invalidated', () => requestGeometry(true)))
  void snap.start()
})
onUnmounted(() => {
  observer?.disconnect()
  stopGeometry()
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
        <UiButton
          variant="ghost"
          type="button"
          class="desktop-window-button"
          :aria-label="t('最小化窗口')"
          :title="t('最小化窗口')"
          @click="controls.run('minimize')"
        >
          <Minus :size="16" :stroke-width="1.5" aria-hidden="true" />
        </UiButton>
        <UiButton
          variant="ghost"
          ref="maximizeButton"
          type="button"
          class="desktop-window-button"
          :class="{
            'is-native-hovered': nativeHovered,
            'is-native-pressed': nativeHovered && nativePressed,
          }"
          :data-native-snap="snapEnabled || undefined"
          :aria-label="t(maximized ? '还原窗口' : '最大化窗口')"
          :title="t(maximized ? '还原窗口' : '最大化窗口')"
          @click="controls.run('toggleMaximize')"
        >
          <Copy v-if="maximized" :size="13" :stroke-width="1.5" aria-hidden="true" />
          <Square v-else :size="13" :stroke-width="1.5" aria-hidden="true" />
        </UiButton>
        <UiButton
          variant="ghost"
          type="button"
          class="desktop-window-button desktop-window-close"
          :aria-label="t('关闭窗口')"
          :title="t('关闭窗口')"
          @click="controls.run('close')"
        >
          <X :size="17" :stroke-width="1.5" aria-hidden="true" />
        </UiButton>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.desktop-titlebar {
  position: fixed;
  inset: 0 0 auto;
  width: 100vw;
  right: auto;
  z-index: 50;
  height: var(--desktop-titlebar-height, 36px);
  display: flex;
  align-items: stretch;
  background: var(--app-rail);
  color: var(--ui-text);
  border-bottom: 1px solid var(--line);
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
  font-size: var(--font-size-meta);
  font-weight: var(--font-weight-medium);
  letter-spacing: 0.1px;
}
.desktop-titlebar-error {
  margin-left: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #a43d35;
  font-size: var(--font-size-meta);
}
.desktop-window-controls {
  display: flex;
  flex-shrink: 0;
}
.desktop-window-button {
  min-height: 0;
  display: grid;
  place-items: center;
  width: 44px;
  height: 100%;
  padding: 0;
  border-radius: 0;
  cursor: default;
}
.desktop-window-button:hover,
.desktop-window-button.is-native-hovered {
  background: #dfe5d9;
}
.desktop-window-button:active,
.desktop-window-button.is-native-pressed {
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
