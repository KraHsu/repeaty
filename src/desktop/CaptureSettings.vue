<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, shallowRef } from 'vue'
import { captureStatus, configureCapture, type CaptureStatus } from './collection'
import { useApplication } from '../app/context'
import { SettingGroup, SettingField, UiButton, UiNotice } from '../components/ui'
import { t, type DisplayMessage } from '../i18n'
import { captureMessage } from '../core/capture-errors'
const { capture, workspace } = useApplication()
const status = shallowRef<CaptureStatus>(),
  enabled = ref(false),
  shortcut = ref('CommandOrControl+Shift+Space'),
  mode = ref<'selection' | 'clipboard'>('clipboard'),
  busy = ref(false),
  error = shallowRef<DisplayMessage>(''),
  unavailable = computed(() => busy.value || !status.value?.shortcutAvailable),
  statusError = computed(() =>
    status.value?.error && status.value.error !== 'capture-shortcut-unsupported'
      ? captureMessage(status.value.error)
      : '',
  )
let alive = true
onUnmounted(() => {
  alive = false
})
function apply(value: CaptureStatus) {
  status.value = value
  enabled.value = value.configuration.enabled
  shortcut.value = value.configuration.shortcut
  mode.value = value.selection ? value.configuration.mode : 'clipboard'
}
async function save() {
  if (unavailable.value) return
  busy.value = true
  error.value = ''
  try {
    const next = await configureCapture({
      enabled: enabled.value,
      shortcut: shortcut.value,
      mode: mode.value,
    })
    if (alive) apply(next)
  } catch (reason) {
    if (alive) error.value = captureMessage(reason)
  } finally {
    if (alive) busy.value = false
  }
}
onMounted(async () => {
  try {
    const next = await captureStatus()
    if (alive) apply(next)
  } catch (reason) {
    if (alive) error.value = captureMessage(reason)
  }
})
</script>
<template>
  <SettingGroup
    :title="t('快捷收集')"
    :description="t('在其他应用中收集文字、图片或文件，保存到当前学习库的收件箱。')"
  >
    <UiNotice v-if="status && !status.shortcutAvailable" tone="warning">
      {{ t('当前平台不支持全局快捷键。请在学习材料中使用“收集材料”。') }}
    </UiNotice>
    <UiNotice v-if="!workspace.ready.value || !workspace.scope.value" tone="info">
      {{ t('请先打开学习库，收集的内容才会保存到该库的收件箱。') }}
    </UiNotice>
    <SettingField
      :label="t('全局快捷键')"
      type="switch"
      :model-value="enabled"
      :disabled="unavailable"
      @update:model-value="enabled = Boolean($event)"
    />
    <SettingField
      :label="t('快捷键组合')"
      :model-value="shortcut"
      :description="t('例如 CommandOrControl+Shift+Space。占用冲突时会显示错误。')"
      :disabled="unavailable"
      @update:model-value="shortcut = String($event)"
    />
    <SettingField
      :label="t('收集内容')"
      type="select"
      :model-value="mode"
      :options="
        status?.selection
          ? [
              { value: 'selection', label: t('当前应用选中的文字') },
              { value: 'clipboard', label: t('剪贴板文字、图片或文件') },
            ]
          : [{ value: 'clipboard', label: t('剪贴板文字、图片或文件') }]
      "
      :disabled="unavailable"
      @update:model-value="mode = $event === 'selection' ? 'selection' : 'clipboard'"
    />
    <UiNotice v-if="status?.permission === 'accessibility-required'" tone="warning">{{
      t('请在系统设置的辅助功能中允许 Repeaty 读取选区；也可以使用剪贴板模式。')
    }}</UiNotice>
    <p v-if="status?.shortcutAvailable && !status.selection" class="capture-help">
      {{ t('当前平台使用剪贴板模式。先复制，再按快捷键；原剪贴板内容保持不变。') }}
    </p>
    <UiNotice v-if="error || statusError" tone="error">{{ t(error || statusError) }}</UiNotice>
    <div class="capture-actions">
      <UiButton :disabled="unavailable" @click="save">{{ t('保存快捷键') }}</UiButton
      ><span role="status">{{ t(status?.registered ? '快捷键已启用' : '快捷键未启用') }}</span>
    </div>
  </SettingGroup>
  <SettingGroup v-if="capture.pending.value || capture.error.value" :title="t('上次收集')">
    <UiNotice v-if="capture.error.value" tone="error">{{ t(capture.error.value) }}</UiNotice>
    <template v-if="capture.pending.value"
      ><p>{{ t('内容尚未保存，仍保留在当前窗口中。关闭窗口前请重试或放弃。') }}</p>
      <div class="capture-actions">
        <UiButton :disabled="capture.saving.value" @click="capture.retry">{{
          t('重试保存')
        }}</UiButton
        ><UiButton variant="ghost" :disabled="capture.saving.value" @click="capture.discard">{{
          t('放弃本次收集')
        }}</UiButton>
      </div></template
    >
  </SettingGroup>
</template>
<style scoped>
.capture-actions {
  display: flex;
  align-items: center;
  gap: 1rem;
  flex-wrap: wrap;
}
.capture-actions span,
.capture-help {
  color: var(--ink-soft);
  font-size: var(--font-size-meta);
}
</style>
