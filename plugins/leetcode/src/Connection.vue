<script setup lang="ts">
import { computed, onUnmounted, ref, useId, watch } from 'vue'
import {
  SettingSection,
  SettingField,
  UiButton,
  UiNotice,
  UiStatus,
  vUiButton,
} from '@repeaty/plugin-api'
import { t, locale } from './i18n'
import { bridgeRequest, BridgeError, configureCredentials, pluginRequest } from './bridge'
import {
  accountSchema,
  configurationSchema,
  onAccountIssue,
  reportAccountIssue,
  type AccountStatus,
} from './account'
import type { LeetCodeSite } from './model'
const props = defineProps<{ site: LeetCodeSite }>()
const configured = ref<string[]>()
const loading = ref(true)
const error = ref('')
const abort = new AbortController()
const fieldId = useId()
const session = ref('')
const csrf = ref('')
const saving = ref(false)
const confirmation = ref(false)
const message = ref('')
const saveError = ref('')
const account = ref<AccountStatus>()
const checking = ref(false)
const validationIssue = ref('')
const checkedAt = ref<Date>()
let refreshId = 0
function resetValidation() {
  account.value = undefined
  checkedAt.value = undefined
  checking.value = false
  validationIssue.value = ''
}
function clearDraft() {
  session.value = ''
  csrf.value = ''
  confirmation.value = false
  message.value = ''
  saveError.value = ''
}
function enterCredential(event: KeyboardEvent) {
  // The Enter that commits an IME composition must reach the input, not save a half-typed
  // cookie pair; stopping it also prevents the composition from ever committing.
  if (event.isComposing || event.keyCode === 229) return
  event.stopPropagation()
  event.preventDefault()
  void configure('save')
}
async function configure(action: 'save' | 'clear') {
  if (saving.value || loading.value) return
  const site = props.site
  const values = { session: session.value.trim(), csrf: csrf.value.trim() }
  if (
    action === 'save' &&
    Object.values(values).some(
      (value) => !value || value.length > 8192 || /[^\x21-\x7e]|;/.test(value),
    )
  ) {
    saveError.value = '请填写两个 Cookie 的值，不要包含名称、空格或分号。'
    return
  }
  saving.value = true
  saveError.value = ''
  message.value = ''
  const id = ++refreshId
  resetValidation()
  let saved = false
  try {
    const status = configurationSchema.parse(
      await configureCredentials({
        action,
        site,
        ...(action === 'save' ? values : {}),
      }),
    )
    if (id === refreshId && props.site === site && !abort.signal.aborted) {
      clearDraft()
      configured.value = status.configured
      loading.value = false
      error.value = ''
      message.value = action === 'save' ? '登录信息已保存在本机。' : '登录信息已清除。'
      saved = action === 'save'
      reportAccountIssue(site, 'credentials-changed')
    }
  } catch {
    if (id === refreshId && props.site === site && !abort.signal.aborted) {
      saveError.value = '操作未确认成功，请刷新状态后重试。'
    }
  } finally {
    saving.value = false
  }
  if (saved) await verify(site, id)
}
const siteName = computed(() =>
  props.site === 'leetcode.cn' ? '中国站 · leetcode.cn' : '国际站 · leetcode.com',
)
const hasCredentials = computed(() => configured.value?.includes(props.site) === true)
const verified = computed(
  () =>
    !loading.value &&
    !checking.value &&
    !error.value &&
    !validationIssue.value &&
    account.value?.state === 'authenticated',
)
const statusLabel = computed(() => {
  if (loading.value) return '正在读取连接状态…'
  if (error.value) return '状态读取失败'
  if (!hasCredentials.value) return '未配置登录信息'
  if (checking.value) return '正在验证登录…'
  if (verified.value) return '登录有效'
  if (account.value?.state === 'expired') return '登录已失效'
  if (validationIssue.value === 'verification-required') return '需要网页验证'
  if (['request-failed', 'submission-unknown'].includes(validationIssue.value))
    return '网络连接异常'
  if (validationIssue.value === 'rate-limit') return '验证暂时受限'
  return '尚未确认登录状态'
})
const statusTone = computed(() => {
  if (loading.value || checking.value) return 'busy'
  if (verified.value) return 'success'
  if (error.value || account.value?.state === 'expired') return 'danger'
  return hasCredentials.value ? 'warning' : 'neutral'
})
const validationMessages: Record<string, string> = {
  'verification-required': '力扣要求额外验证，请在网站完成验证后重试。',
  'request-failed': '无法连接力扣，已保存的登录信息仍然保留。请检查网络后重试。',
  'submission-unknown': '无法连接力扣，已保存的登录信息仍然保留。请检查网络后重试。',
  'rate-limit': '力扣暂时限制验证请求，请稍后刷新状态。',
  'credentials-changed': '登录信息已更新，请刷新状态后重试。',
  'invalid-response': '无法识别力扣返回的验证结果，请稍后重试。',
}
const issueMessage = computed(() => validationMessages[validationIssue.value] ?? '')
async function verify(site: LeetCodeSite, id: number) {
  if (id !== refreshId || props.site !== site || abort.signal.aborted) return
  checking.value = true
  try {
    const raw = await bridgeRequest({ action: 'account', site }, abort.signal)
    const result = accountSchema.safeParse(raw)
    if (!result.success || result.data.site !== site) throw new BridgeError('invalid-response')
    if (id !== refreshId || props.site !== site || abort.signal.aborted) return
    account.value = result.data
    checkedAt.value = new Date()
    if (result.data.state === 'unconfigured') {
      configured.value = configured.value?.filter((entry) => entry !== site)
      checkedAt.value = undefined
    }
  } catch (issue) {
    if (id !== refreshId || props.site !== site || abort.signal.aborted) return
    if (issue instanceof BridgeError && issue.code === 'login-required') {
      account.value = { site, state: 'expired' }
      checkedAt.value = new Date()
    } else {
      account.value = undefined
      validationIssue.value = issue instanceof BridgeError ? issue.code : 'request-failed'
    }
  } finally {
    if (id === refreshId && !abort.signal.aborted) checking.value = false
  }
}
async function refresh() {
  const id = ++refreshId
  loading.value = true
  error.value = ''
  resetValidation()
  try {
    const status = configurationSchema.parse(
      await pluginRequest({
        action: 'ping',
      }),
    )
    if (id !== refreshId || abort.signal.aborted) return
    configured.value = status.configured
  } catch {
    if (id === refreshId && !abort.signal.aborted) {
      configured.value = undefined
      error.value = '无法读取本机插件状态，请重试。'
    }
  } finally {
    if (id === refreshId) loading.value = false
  }
  if (id === refreshId && hasCredentials.value) await verify(props.site, id)
}
const stopIssues = onAccountIssue(({ site, code }) => {
  if (
    site !== props.site ||
    saving.value ||
    loading.value ||
    !hasCredentials.value ||
    abort.signal.aborted
  )
    return
  if (code === 'credentials-changed') {
    void refresh()
    return
  }
  ++refreshId
  resetValidation()
  if (code === 'login-required') account.value = { site, state: 'expired' }
  else validationIssue.value = code
})
watch(
  () => props.site,
  () => {
    clearDraft()
    void refresh()
  },
  { immediate: true },
)
onUnmounted(() => {
  abort.abort()
  stopIssues()
  clearDraft()
})
</script>
<template>
  <SettingSection
    class="leetcode-connection"
    :title="t(site === 'leetcode.cn' ? '中国站' : '国际站')"
    :description="site"
    :level="3"
    :aria-label="t(siteName)"
  >
    <template #actions>
      <a v-ui-button="'ghost'" :href="`https://${site}/`" target="_blank" rel="noopener noreferrer"
        >{{ t('打开力扣网站') }} ↗</a
      >
      <UiButton :disabled="loading || saving || checking" @click="refresh">
        {{ t('刷新状态') }}
      </UiButton>
    </template>
    <div class="leetcode-connection__status-row" role="status" aria-live="polite">
      <span class="leetcode-connection__status-label">{{ t('连接状态') }}</span>
      <UiStatus :tone="statusTone">{{ t(statusLabel) }}</UiStatus>
    </div>
    <div v-if="verified || checkedAt" class="leetcode-connection__metadata">
      <p v-if="verified && account?.state === 'authenticated'" class="connection-account">
        {{ t('当前账号：{username}', { username: account.username }) }}
      </p>
      <p v-if="checkedAt && !checking">
        {{ t('验证时间：{time}', { time: checkedAt.toLocaleString(locale) }) }}
      </p>
    </div>
    <UiNotice v-if="error" tone="error">{{ t(error) }}</UiNotice>
    <UiNotice v-else-if="issueMessage" tone="error">{{ t(issueMessage) }}</UiNotice>
    <UiNotice v-else-if="account?.state === 'expired'" tone="warning" role="alert">
      {{ t('登录信息无效或已过期，请重新登录力扣并更新下方 Cookie。') }}
    </UiNotice>
    <UiNotice v-else-if="!loading && !hasCredentials">
      {{ t('可读取公开题目。提交判题前，请填写下方的登录信息。') }}
    </UiNotice>
    <UiNotice v-else-if="checking">
      {{ t('正在向力扣验证登录。你可以继续编辑代码或更新登录信息。') }}
    </UiNotice>
    <fieldset class="connection-credentials" :disabled="saving || loading">
      <legend>{{ t('登录信息') }}</legend>
      <p class="leetcode-connection__description">
        {{ t('填写 Cookie 的值。保存后立即生效；已保存的值不会回填。') }}
      </p>
      <div class="credential-fields" @keydown.enter="enterCredential($event)">
        <SettingField
          :id="`${fieldId}-session`"
          label="LEETCODE_SESSION"
          :model-value="session"
          type="password"
          layout="stack"
          autocomplete="new-password"
          :spellcheck="false"
          autocapitalize="off"
          :maxlength="8192"
          :placeholder="t('粘贴 Cookie 值')"
          @update:model-value="session = String($event)"
        />
        <SettingField
          :id="`${fieldId}-csrf`"
          label="csrftoken"
          :model-value="csrf"
          type="password"
          layout="stack"
          autocomplete="new-password"
          :spellcheck="false"
          autocapitalize="off"
          :maxlength="8192"
          :placeholder="t('粘贴 Cookie 值')"
          @update:model-value="csrf = String($event)"
        />
      </div>
      <UiNotice v-if="saveError" tone="error">{{ t(saveError) }}</UiNotice>
      <UiNotice v-if="message" tone="success" role="note" aria-live="polite">{{
        t(message)
      }}</UiNotice>
      <div class="ui-setting-actions">
        <UiButton
          variant="primary"
          :disabled="saving || !session.trim() || !csrf.trim()"
          @click="configure('save')"
        >
          {{ t(saving ? '正在保存…' : '保存登录信息') }}
        </UiButton>
        <UiButton v-if="hasCredentials && !confirmation" @click="confirmation = true">
          {{ t('清除登录信息') }}
        </UiButton>
      </div>
      <UiNotice v-if="confirmation" tone="warning" class="credential-confirmation">
        {{ t('清除后需重新填写登录信息才能提交判题。') }}
        <template #actions>
          <UiButton variant="danger" @click="configure('clear')">
            {{ t('确认清除') }}
          </UiButton>
          <UiButton @click="confirmation = false">
            {{ t('取消') }}
          </UiButton>
        </template>
      </UiNotice>
    </fieldset>
    <details class="leetcode-connection__help ui-setting-help">
      <summary>{{ t('在哪里找到这两个值？') }}</summary>
      <div class="leetcode-connection__help-body">
        <p>{{ t('打开力扣网站并登录，不会自动连接 Repeaty。请在此保存对应 Cookie。') }}</p>
        <p>
          {{
            t(
              '在对应的力扣站点登录，打开浏览器开发者工具 → 应用（Application）或存储（Storage）→ Cookie，复制 LEETCODE_SESSION 和 csrftoken 的值，粘贴到上方。登录过期后重新填写。',
            )
          }}
        </p>
        <p>
          {{
            t('登录信息仅保存在本机，由桌面版直接连接力扣，不会发送给上游服务或包含在卡组导出中。')
          }}
        </p>
        <a
          v-ui-button="'ghost'"
          href="https://github.com/KraHsu/repeaty/blob/main/docs/LEETCODE.md#配置与启用"
          target="_blank"
          rel="noopener noreferrer"
          >{{ t('完整配置文档') }} ↗</a
        >
      </div>
    </details>
  </SettingSection>
</template>

<style scoped>
.leetcode-connection {
  font-size: var(--font-size-body);
  line-height: var(--line-height-ui);
}
.leetcode-connection__status-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 0.75rem;
  min-width: 0;
}
.leetcode-connection__status-label {
  font-size: var(--font-size-control);
  font-weight: var(--font-weight-medium);
}
.leetcode-connection__metadata {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 0.5rem 1.5rem;
  color: var(--muted);
  font-size: var(--font-size-meta);
  overflow-wrap: anywhere;
}
.leetcode-connection__metadata p {
  margin: 0;
}
.leetcode-connection .connection-credentials {
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}
.leetcode-connection .connection-credentials legend {
  margin-bottom: 0.5rem;
  padding: 0;
  font-size: var(--font-size-control);
  font-weight: var(--font-weight-medium);
}
.leetcode-connection__description {
  margin: 0;
  color: var(--muted);
  font-size: var(--font-size-meta);
}
.leetcode-connection .credential-fields {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 260px), 1fr));
  margin: 0;
  gap: 0 1.5rem;
}
.credential-fields > .ui-setting-field {
  border-top: 0;
}
.connection-credentials > .ui-notice {
  margin-bottom: 1rem;
}
.credential-confirmation {
  margin-top: 1rem;
}
.leetcode-connection .leetcode-connection__help {
  margin: 0;
}
.leetcode-connection__help-body {
  display: grid;
  gap: 0.75rem;
  padding: 0.75rem 0;
  color: var(--muted);
  font-size: var(--font-size-meta);
  line-height: var(--line-height-ui);
}
.leetcode-connection__help-body p {
  margin: 0;
}
</style>
