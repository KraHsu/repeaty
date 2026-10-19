<script setup lang="ts">
import { computed, onUnmounted, ref, useId, watch } from 'vue'
import { t, locale } from '../../i18n'
import { localPlugin } from '../../desktop/native'
import { bridgeRequest, BridgeError } from './bridge'
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
      await localPlugin('leetcode', 'credentials', {
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
      await localPlugin('leetcode', 'request', {
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
  <section class="leetcode-connection" :aria-label="t(siteName)">
    <div class="connection-header">
      <div>
        <h3>{{ t(siteName) }}</h3>
        <p class="connection-status" role="status">
          {{ t('LeetCode 登录') }}
          <strong :class="{ configured: verified }">{{ t(statusLabel) }}</strong>
        </p>
        <p v-if="verified && account?.state === 'authenticated'" class="connection-account">
          {{ t('当前账号：{username}', { username: account.username }) }}
        </p>
        <p v-if="checkedAt && !checking" class="form-note">
          {{ t('验证时间：{time}', { time: checkedAt.toLocaleString(locale) }) }}
        </p>
      </div>
      <button
        type="button"
        class="button secondary"
        :disabled="loading || saving || checking"
        @click="refresh"
      >
        {{ t('刷新状态') }}
      </button>
    </div>
    <p v-if="error" class="import-warning" role="alert">{{ t(error) }}</p>
    <p v-else-if="issueMessage" class="import-warning" role="alert">{{ t(issueMessage) }}</p>
    <p v-else-if="account?.state === 'expired'" class="import-warning" role="alert">
      {{ t('登录信息无效或已过期，请重新登录力扣并更新下方 Cookie。') }}
    </p>
    <p v-else-if="!loading && !hasCredentials">
      {{ t('可读取公开题目。提交判题前，请填写下方的登录信息。') }}
    </p>
    <p v-else-if="checking" class="form-note">
      {{ t('正在向力扣验证登录。你可以继续编辑代码或更新登录信息。') }}
    </p>
    <p>{{ t('打开力扣网站并登录，不会自动连接 Repeaty。请将登录信息填入下方。') }}</p>
    <a class="text-button" :href="`https://${site}/`" target="_blank" rel="noopener noreferrer"
      >{{ t('打开力扣网站') }} ↗</a
    >
    <fieldset class="connection-credentials" :disabled="saving || loading">
      <legend>{{ t(hasCredentials ? '更新登录信息' : '配置登录信息') }}</legend>
      <p class="form-note">
        {{ t('填写 Cookie 的值。保存后立即生效；已保存的值不会回填。') }}
      </p>
      <div class="credential-fields" @keydown.enter.stop.prevent="configure('save')">
        <label class="form-field" :for="`${fieldId}-session`"
          >LEETCODE_SESSION
          <input
            :id="`${fieldId}-session`"
            v-model="session"
            type="password"
            autocomplete="new-password"
            :spellcheck="false"
            autocapitalize="off"
            :maxlength="8192"
            :placeholder="t('粘贴 Cookie 值')"
          />
        </label>
        <label class="form-field" :for="`${fieldId}-csrf`"
          >csrftoken
          <input
            :id="`${fieldId}-csrf`"
            v-model="csrf"
            type="password"
            autocomplete="new-password"
            :spellcheck="false"
            autocapitalize="off"
            :maxlength="8192"
            :placeholder="t('粘贴 Cookie 值')"
          />
        </label>
      </div>
      <p v-if="saveError" class="import-warning" role="alert">{{ t(saveError) }}</p>
      <p v-if="message" class="form-note" aria-live="polite">{{ t(message) }}</p>
      <div class="connection-actions">
        <button
          type="button"
          class="button primary"
          :disabled="saving || !session.trim() || !csrf.trim()"
          @click="configure('save')"
        >
          {{ t(saving ? '正在保存…' : '保存登录信息') }}
        </button>
        <button
          v-if="hasCredentials && !confirmation"
          type="button"
          class="button secondary"
          @click="confirmation = true"
        >
          {{ t('清除登录信息') }}
        </button>
      </div>
      <div v-if="confirmation" class="credential-confirmation">
        <p>{{ t('清除后需重新填写登录信息才能提交判题。') }}</p>
        <div class="connection-actions">
          <button type="button" class="button danger" @click="configure('clear')">
            {{ t('确认清除') }}
          </button>
          <button type="button" class="button secondary" @click="confirmation = false">
            {{ t('取消') }}
          </button>
        </div>
      </div>
      <p class="form-note">
        {{
          t('登录信息仅保存在本机，由桌面版直接连接力扣，不会发送给上游服务或包含在卡组导出中。')
        }}
      </p>
    </fieldset>
    <details>
      <summary>{{ t('在哪里找到这两个值？') }}</summary>
      <p>
        {{
          t(
            '在对应的力扣站点登录，打开浏览器开发者工具 → 应用（Application）或存储（Storage）→ Cookie，复制 LEETCODE_SESSION 和 csrftoken 的值，粘贴到上方。登录过期后重新填写。',
          )
        }}
      </p>
      <a
        href="https://github.com/KraHsu/repeaty/blob/main/docs/LEETCODE.md#配置与启用"
        target="_blank"
        rel="noopener noreferrer"
        >{{ t('完整配置文档') }} ↗</a
      >
    </details>
  </section>
</template>
