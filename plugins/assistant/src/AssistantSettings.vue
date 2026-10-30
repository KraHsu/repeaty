<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  SettingField,
  SettingSection,
  UiButton,
  UiNotice,
  UiStatus,
  readSetting,
  writeSetting,
} from '@repeaty/plugin-api'
import type { ModelStatus } from '@repeaty/plugin-api/providers'
import { profiles } from './bridge'
import { safeError, type ProviderProfile } from './model'
import { errorText, t } from './text'

const items = ref<ProviderProfile[]>([])
const active = ref('')
const editing = ref<ProviderProfile>({
  id: '',
  name: '',
  kind: 'openai-compatible',
  endpoint: '',
  model: '',
})
const key = ref('')
const busy = ref(false)
const unavailable = ref(false)
const error = ref('')
const saved = ref('')
const status = ref<ModelStatus>()
const login = ref<{ authUrl?: string; verificationUrl?: string; userCode?: string }>()
let alive = true
const options = computed(() => [
  { value: '', label: t('添加连接', 'Add connection') },
  ...items.value.map((item) => ({ value: item.id, label: item.name })),
])
const kinds = computed(() => [
  { value: 'openai-compatible', label: t('兼容 OpenAI 的 API', 'OpenAI-compatible API') },
  { value: 'codex-app-server', label: 'Codex app-server' },
])
const models = computed(
  () => status.value?.models.map((model) => ({ value: model.id, label: model.name })) ?? [],
)
const capabilityLabel = (value: string) =>
  value === 'supported'
    ? t('支持', 'Supported')
    : value === 'unsupported'
      ? t('不支持', 'Unsupported')
      : t('尚未确认', 'Not verified')
const loginUrl = computed(() => {
  const value = login.value?.authUrl ?? login.value?.verificationUrl
  if (!value) return undefined
  try {
    return new URL(value).protocol === 'https:' ? value : undefined
  } catch {
    return undefined
  }
})
function select(id: string) {
  active.value = id
  editing.value = {
    ...(items.value.find((item) => item.id === id) ?? {
      id: '',
      name: '',
      kind: 'openai-compatible',
      endpoint: '',
      model: '',
    }),
  }
  key.value = ''
  error.value = ''
  saved.value = ''
  status.value = undefined
  login.value = undefined
}
async function run(action: 'save' | 'test' | 'delete' | 'login' | 'logout') {
  if (busy.value) return
  busy.value = true
  error.value = ''
  saved.value = ''
  try {
    if (action === 'save') {
      const item = await profiles.save(editing.value, key.value || undefined)
      if (!alive) return
      items.value = await profiles.list()
      if (!alive) return
      select(item.id)
      writeSetting('default-profile', item.id)
      saved.value = t('连接已保存在此设备。', 'Connection saved on this device.')
    } else if (action === 'test') {
      const result = await profiles.test(active.value)
      if (!alive) return
      status.value = result
      if (result.error) error.value = errorText(safeError(result.error))
    } else if (action === 'delete') {
      await profiles.remove(active.value)
      if (!alive) return
      items.value = await profiles.list()
      if (!alive) return
      select('')
      saved.value = t(
        '连接已移除，对话和学习数据保留。',
        'Connection removed. Conversations and learning data are kept.',
      )
    } else if (action === 'login') {
      const result = await profiles.login(active.value)
      if (alive) login.value = result
    } else {
      await profiles.logout(active.value)
      if (alive) {
        status.value = undefined
        login.value = undefined
        saved.value = t(
          '已退出此设备的助手账号。',
          'Signed out of the assistant account on this device.',
        )
      }
    }
  } catch (value) {
    if (alive) error.value = errorText(safeError(value))
  } finally {
    if (alive) {
      key.value = ''
      busy.value = false
    }
  }
}
onMounted(async () => {
  try {
    const list = await profiles.list()
    if (alive) {
      items.value = list
      select(
        list.find((item) => item.id === readSetting('default-profile'))?.id ?? list[0]?.id ?? '',
      )
    }
  } catch {
    if (alive) unavailable.value = true
  }
})
onBeforeUnmount(() => {
  alive = false
  key.value = ''
})
</script>

<template>
  <SettingSection :title="t('模型连接', 'Model connections')">
    <UiNotice v-if="unavailable" tone="info">{{
      t(
        '模型连接需要桌面版。已保存的对话仍可查看。',
        'Model connections require the desktop app. Saved conversations remain available.',
      )
    }}</UiNotice>
    <template v-else>
      <SettingField
        :model-value="active"
        type="select"
        :label="t('连接', 'Connection')"
        :options="options"
        :disabled="busy"
        @update:model-value="(value) => select(String(value))"
      />
      <SettingField
        v-model="editing.name"
        :label="t('名称', 'Name')"
        :placeholder="t('例如：日常学习', 'For example: Daily study')"
        :disabled="busy"
      />
      <SettingField
        v-model="editing.kind"
        type="select"
        :label="t('提供方类型', 'Provider type')"
        :options="kinds"
        :disabled="busy || !!active"
      />
      <template v-if="editing.kind === 'openai-compatible'">
        <SettingField
          v-model="editing.endpoint"
          :label="t('API 地址', 'API endpoint')"
          placeholder="https://api.example.com/v1"
          :disabled="busy"
          :spellcheck="false"
        />
        <SettingField
          v-model="key"
          type="password"
          :label="editing.hasCredential ? t('替换 API key', 'Replace API key') : 'API key'"
          :placeholder="
            editing.hasCredential
              ? t('留空保留已保存的凭据', 'Leave empty to keep the saved credential')
              : t('由模型服务商提供', 'Provided by your model service')
          "
          :description="
            t(
              '仅保存在此设备，不写入对话、学习库或备份。API 访问权限和费用由提供方决定。',
              'Stored only on this device, outside conversations, libraries and backups. API access and charges depend on the provider.',
            )
          "
          autocomplete="off"
          :spellcheck="false"
          :disabled="busy"
        />
      </template>
      <SettingField
        v-else
        :model-value="editing.executable ?? ''"
        :label="t('Codex 可执行文件', 'Codex executable')"
        :placeholder="t('留空自动查找已安装的 Codex', 'Leave empty to locate an installed Codex')"
        :description="
          t(
            '使用独立的设备会话。登录后点“测试连接”读取可用模型。',
            'Uses a separate device session. After signing in, test the connection to load available models.',
          )
        "
        :disabled="busy"
        @update:model-value="(value) => (editing.executable = String(value))"
      />
      <SettingField
        v-if="models.length"
        v-model="editing.model"
        type="select"
        :label="t('默认模型', 'Default model')"
        :options="models"
        :disabled="busy"
      />
      <SettingField
        v-else
        v-model="editing.model"
        :label="t('默认模型', 'Default model')"
        :placeholder="t('填写提供方的模型 ID', 'Enter a provider model ID')"
        :disabled="busy"
      />
      <div class="assistant-settings-actions">
        <UiButton
          variant="primary"
          :disabled="
            busy ||
            !editing.name.trim() ||
            (editing.kind === 'openai-compatible' &&
              (!editing.endpoint.trim() || !editing.model.trim()))
          "
          :busy="busy"
          @click="run('save')"
          >{{ t('保存连接', 'Save connection') }}</UiButton
        >
        <UiButton variant="secondary" :disabled="busy || !active" @click="run('test')">{{
          t('测试连接', 'Test connection')
        }}</UiButton>
        <UiButton
          v-if="editing.kind === 'codex-app-server'"
          variant="secondary"
          :disabled="busy || !active"
          @click="run('login')"
          >{{ t('登录账号', 'Sign in') }}</UiButton
        >
        <UiButton
          v-if="editing.kind === 'codex-app-server'"
          variant="ghost"
          :disabled="busy || !active"
          @click="run('logout')"
          >{{ t('退出账号', 'Sign out') }}</UiButton
        >
        <UiButton variant="ghost" :disabled="busy || !active" @click="run('delete')">{{
          t('移除连接', 'Remove connection')
        }}</UiButton>
      </div>
      <UiNotice v-if="loginUrl" tone="info">
        <p v-if="login?.userCode">
          {{ t('登录验证码：', 'Sign-in code: ') }}<strong>{{ login.userCode }}</strong>
        </p>
        <UiButton :href="loginUrl" target="_blank" rel="noopener noreferrer">{{
          t('打开登录页面', 'Open sign-in page')
        }}</UiButton>
      </UiNotice>
      <UiStatus
        v-if="status"
        :tone="status.available && status.authenticated ? 'success' : 'neutral'"
        >{{
          status.available && status.authenticated
            ? t('连接可用', 'Connected')
            : t('尚未连接', 'Not connected')
        }}</UiStatus
      >
      <p v-if="status" class="assistant-connection-detail">
        {{ t('工具调用：', 'Tool calling: ') }}{{ capabilityLabel(status.tools) }} ·
        {{ t('图片：', 'Images: ') }}{{ capabilityLabel(status.images) }}
      </p>
      <UiNotice v-if="error" tone="error">{{ error }}</UiNotice>
      <UiNotice v-if="saved" tone="success">{{ saved }}</UiNotice>
    </template>
  </SettingSection>
</template>

<style scoped>
.assistant-settings-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}
.assistant-connection-detail {
  color: var(--muted);
  font-size: var(--font-size-meta);
}
</style>
