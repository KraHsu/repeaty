<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import {
  locale,
  SettingSection,
  SettingField,
  UiButton,
  UiNotice,
  UiStatus,
} from '@repeaty/plugin-api'
import { api } from './bridge'

const token = ref('')
const configured = ref(false)
const busy = ref(false)
const available = ref(true)
const error = ref('')
const message = ref('')
const controller = new AbortController()
const t = (zh: string, en: string) => (locale.value === 'en' ? en : zh)
const context = {
  signal: controller.signal,
  progress() {},
  async yield() {
    controller.signal.throwIfAborted()
  },
}
function displayError(value: unknown) {
  if (value instanceof Error) return value.message
  if (value === 'plugin-network-error')
    return t(
      '无法连接 Readwise，请检查网络后重试。',
      'Could not reach Readwise. Check your connection and try again.',
    )
  return t(
    '此操作需要桌面版的联网与凭据权限。',
    'This action requires network and credential permissions in the desktop app.',
  )
}
async function run(action: 'save' | 'clear' | 'check') {
  if (busy.value) return
  busy.value = true
  error.value = ''
  message.value = ''
  try {
    if (action === 'check') await api.check(context)
    else await api.configure(action === 'save' ? token.value.trim() : undefined)
    if (controller.signal.aborted) return
    configured.value = !!(await api.state())
    token.value = ''
    message.value =
      action === 'check'
        ? t('连接成功。', 'Connection verified.')
        : action === 'save'
          ? t('Token 已保存在此设备。', 'Token saved on this device.')
          : t('Token 已移除，已导入内容保留。', 'Token removed. Imported content is kept.')
  } catch (value) {
    if (!controller.signal.aborted) error.value = displayError(value)
  } finally {
    if (!controller.signal.aborted) busy.value = false
  }
}
function enter(event: KeyboardEvent) {
  if (event.isComposing || event.keyCode === 229) return
  event.preventDefault()
  event.stopPropagation()
  if (token.value.trim()) void run('save')
}
onMounted(async () => {
  busy.value = true
  try {
    const value = await api.state()
    if (!controller.signal.aborted) configured.value = !!value
  } catch {
    if (!controller.signal.aborted) available.value = false
  } finally {
    if (!controller.signal.aborted) busy.value = false
  }
})
onUnmounted(() => {
  controller.abort()
  token.value = ''
})
</script>

<template>
  <SettingSection :title="t('API 连接', 'API connection')">
    <UiNotice v-if="!available" tone="info">{{
      t(
        'API 连接需要桌面版。仍可在来源管理中选择本地导出目录。',
        'The API connection requires the desktop app. You can still select a local export folder in Sources.',
      )
    }}</UiNotice>
    <template v-else>
      <UiStatus :tone="configured ? 'success' : 'neutral'">{{
        configured ? t('已保存 Token', 'Token saved') : t('尚未连接', 'Not connected')
      }}</UiStatus>
      <SettingField
        v-model="token"
        type="password"
        :label="configured ? t('替换 access token', 'Replace access token') : 'Access token'"
        :description="
          t(
            '只保存在此设备，不随学习库移动，也不写入导出文件。',
            'Stored only on this device; never copied into the library or exports.',
          )
        "
        :placeholder="
          configured
            ? t('填写新 Token 以替换', 'Enter a new token to replace')
            : t('从 Readwise 获取 Token', 'Enter your Readwise token')
        "
        :disabled="busy"
        :maxlength="4096"
        autocomplete="off"
        autocapitalize="off"
        :spellcheck="false"
        @keydown.enter="enter"
      />
      <div class="readwise-actions">
        <UiButton :disabled="busy || !token.trim()" :busy="busy" @click="run('save')">{{
          t('保存 Token', 'Save token')
        }}</UiButton>
        <UiButton variant="secondary" :disabled="busy || !configured" @click="run('check')">{{
          t('测试连接', 'Test connection')
        }}</UiButton>
        <UiButton variant="ghost" :disabled="busy || !configured" @click="run('clear')">{{
          t('移除 Token', 'Remove token')
        }}</UiButton>
        <UiButton
          variant="ghost"
          href="https://readwise.io/access_token"
          target="_blank"
          rel="noopener noreferrer"
          >{{ t('获取 Token', 'Get token') }}</UiButton
        >
      </div>
      <UiNotice v-if="error" tone="error">{{ error }}</UiNotice>
      <UiNotice v-if="message" tone="success">{{ message }}</UiNotice>
    </template>
  </SettingSection>
</template>

<style scoped>
.readwise-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.625rem;
}
</style>
