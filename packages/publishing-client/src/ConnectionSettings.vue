<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  SettingSection,
  SettingField,
  UiButton,
  UiNotice,
  UiStatus,
  UiCollapsible,
  nativePlugin,
  network,
  pluginData,
  publishing,
} from '@repeaty/plugin-api'
import type { Adapter, Connection, Native, Provider } from './types'
import { fingerprint, record, siteUrl, utf8Base64 } from './util'
import { errorText, loadConnection, native, t } from './ui-state'

const props = defineProps<{
  provider: Provider
  createAdapter: (native: Native, connection: Connection) => Adapter
  authorization?: {
    begin(site: string): Promise<string>
    complete(site: string, payload: string): Promise<string>
    clear(): void
  }
}>()
const scope = publishing.list().workspaceScope
const site = ref('')
const adapter = ref<Connection['adapter']>(props.provider === 'wordpress' ? 'rest' : 'user-api')
const blogId = ref('')
const username = ref('')
const password = ref('')
const payload = ref('')
const authorizationUrl = ref('')
const configured = ref(false)
const saved = ref<Connection>()
const busy = ref(false)
const error = ref('')
const message = ref('')
const controller = new AbortController()
let alive = true
const options = computed(() => [
  { value: 'rest', label: t('WordPress REST（自建站）', 'WordPress REST (self-hosted)') },
  { value: 'xmlrpc', label: 'WordPress.com / XML-RPC' },
])
function clearAuthorization() {
  props.authorization?.clear()
  authorizationUrl.value = ''
  payload.value = ''
}
watch(site, clearAuthorization)
async function action(operation: 'save' | 'check' | 'clear' | 'begin' | 'complete') {
  if (busy.value) return
  busy.value = true
  error.value = ''
  message.value = ''
  try {
    const normalized = siteUrl(operation === 'clear' && saved.value ? saved.value.site : site.value)
    await network.authorize(new URL(normalized).origin)
    controller.signal.throwIfAborted()
    if (operation === 'begin') {
      authorizationUrl.value = await props.authorization!.begin(normalized)
      controller.signal.throwIfAborted()
      return
    }
    const slot = `site-${(await fingerprint(normalized)).slice(0, 40)}`
    const connection: Connection = {
      site: normalized,
      adapter: adapter.value,
      slot,
      ...(adapter.value === 'xmlrpc' ? { blogId: blogId.value } : {}),
    }
    if (operation === 'check')
      await props.createAdapter(native, connection).verify(controller.signal)
    else if (operation === 'clear') {
      await nativePlugin('secrets', { action: 'clear', slot })
      configured.value = false
    } else {
      let values: Record<string, string>
      if (props.provider === 'wordpress') {
        if (!username.value.trim() || !password.value.trim() || username.value.includes(':'))
          throw new Error('credential-unavailable')
        const value = password.value.replace(/\s/g, '')
        values = {
          username: username.value.trim(),
          password: value,
          authorization: `Basic ${utf8Base64(`${username.value.trim()}:${value}`)}`,
        }
      } else {
        const key =
          operation === 'complete'
            ? await props.authorization!.complete(normalized, payload.value)
            : password.value.trim()
        if (!key || key.length > 4096 || /\s/.test(key)) throw new Error('authorization-invalid')
        values = { key }
      }
      controller.signal.throwIfAborted()
      await nativePlugin('secrets', {
        action: 'set',
        slot,
        origin: new URL(normalized).origin,
        values,
      })
      for (const key of Object.keys(values)) values[key] = ''
      password.value = ''
      payload.value = ''
      username.value = ''
      controller.signal.throwIfAborted()
      await props.createAdapter(native, connection).verify(controller.signal)
      controller.signal.throwIfAborted()
      await pluginData.set('connection', connection, scope)
      controller.signal.throwIfAborted()
      saved.value = connection
      configured.value = true
      clearAuthorization()
    }
    if (alive)
      message.value =
        operation === 'check'
          ? t('连接已验证。', 'Connection verified.')
          : operation === 'clear'
            ? t(
                '此设备的凭据已移除，发布关联保留。',
                'Device credentials removed. Publishing links are kept.',
              )
            : t(
                '连接已保存到当前学习库，凭据仅保存在此设备。',
                'Connection saved for this library; credentials stay on this device.',
              )
  } catch (value) {
    if (alive) error.value = errorText(value)
  } finally {
    if (alive) busy.value = false
  }
}
onMounted(async () => {
  try {
    const value = await loadConnection(scope)
    if (!alive || !value) return
    saved.value = value
    site.value = value.site
    adapter.value = value.adapter
    blogId.value = value.blogId ?? ''
    const state = record(await nativePlugin('secrets', { action: 'state' }))
    if (alive)
      configured.value =
        Array.isArray(state.slots) &&
        state.slots
          .map(record)
          .some((entry) => entry.slot === value.slot && entry.origin === new URL(value.site).origin)
  } catch (value) {
    if (alive) error.value = errorText(value)
  }
})
onBeforeUnmount(() => {
  alive = false
  controller.abort()
  clearAuthorization()
  password.value = ''
  username.value = ''
})
</script>

<template>
  <SettingSection
    :title="t('站点连接', 'Site connection')"
    :description="
      t(
        '选择发布目标。账号与应用密码仅保存在此设备。',
        'Choose the publishing destination. Credentials stay on this device.',
      )
    "
  >
    <UiStatus :tone="configured ? 'success' : 'neutral'">{{
      configured ? t('已保存凭据', 'Credentials saved') : t('尚未连接', 'Not connected')
    }}</UiStatus>
    <SettingField
      v-model="site"
      :label="t('站点地址', 'Site URL')"
      placeholder="https://example.com"
      :disabled="busy"
      autocomplete="url"
    />
    <template v-if="provider === 'wordpress'">
      <SettingField
        v-model="adapter"
        type="select"
        :label="t('连接方式', 'Connection type')"
        :options="options"
        :disabled="busy"
      />
      <SettingField
        v-if="adapter === 'xmlrpc'"
        v-model="blogId"
        :label="t('Blog ID（可选）', 'Blog ID (optional)')"
        :description="
          t(
            '留空时，从此账号可访问的站点中自动匹配。',
            'Leave empty to match this site among the account’s accessible blogs.',
          )
        "
        :disabled="busy"
      />
      <SettingField
        v-model="username"
        :label="t('用户名', 'Username')"
        autocomplete="off"
        :disabled="busy"
        :maxlength="120"
      />
      <SettingField
        v-model="password"
        type="password"
        :label="t('应用密码', 'Application password')"
        :description="
          t(
            '使用站点为 Repeaty 签发的应用密码。',
            'Use an application password issued for Repeaty.',
          )
        "
        autocomplete="off"
        :disabled="busy"
        :maxlength="4096"
      />
      <div class="connection-actions">
        <UiButton
          variant="primary"
          :disabled="busy || !site || !username || !password"
          :busy="busy"
          @click="action('save')"
          >{{ t('保存连接', 'Save connection') }}</UiButton
        >
      </div>
    </template>
    <template v-else>
      <div class="connection-actions">
        <UiButton
          variant="primary"
          :disabled="busy || !site"
          :busy="busy"
          @click="action('begin')"
          >{{ t('开始论坛授权', 'Authorize with forum') }}</UiButton
        >
      </div>
      <div v-if="authorizationUrl" class="authorization-flow">
        <UiButton
          :href="authorizationUrl"
          target="_blank"
          rel="noopener noreferrer"
          variant="secondary"
          >{{ t('打开论坛授权页面', 'Open forum authorization') }}</UiButton
        >
        <SettingField
          v-model="payload"
          type="textarea"
          :label="t('粘贴论坛返回的加密结果', 'Paste the encrypted result from the forum')"
          :description="
            t(
              '授权需在 15 分钟内完成，离开设置页后失效。',
              'Complete within 15 minutes. Leaving this page cancels authorization.',
            )
          "
          :disabled="busy"
          autocomplete="off"
        />
        <UiButton variant="primary" :disabled="busy || !payload" @click="action('complete')">{{
          t('验证并保存', 'Verify and save')
        }}</UiButton>
      </div>
      <UiCollapsible>
        <UiButton variant="ghost">{{
          t('已有 User API key', 'Already have a User API key')
        }}</UiButton>
        <template #content
          ><SettingField
            v-model="password"
            type="password"
            label="User API key"
            autocomplete="off"
            :disabled="busy"
          /><UiButton
            variant="primary"
            :disabled="busy || !password || !site"
            @click="action('save')"
            >{{ t('保存密钥', 'Save key') }}</UiButton
          ></template
        >
      </UiCollapsible>
    </template>
    <div class="connection-actions">
      <UiButton
        variant="secondary"
        :disabled="busy || !configured || saved?.site !== site.replace(/\/+$/, '')"
        @click="action('check')"
        >{{ t('测试连接', 'Test connection') }}</UiButton
      >
      <UiButton variant="ghost" :disabled="busy || !configured" @click="action('clear')">{{
        t('移除凭据', 'Remove credentials')
      }}</UiButton>
    </div>
    <UiNotice v-if="error" tone="error">{{ error }}</UiNotice
    ><UiNotice v-if="message" tone="success">{{ message }}</UiNotice>
  </SettingSection>
</template>

<style scoped>
.connection-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.65rem;
}
.authorization-flow {
  display: grid;
  gap: 1rem;
  padding-block: 1rem;
  border-block: 1px solid var(--ui-border);
}
</style>
