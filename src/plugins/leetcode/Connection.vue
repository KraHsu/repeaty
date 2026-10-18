<script setup lang="ts">
import { computed, onUnmounted, ref, useId, watch } from 'vue'
import { t } from '../../i18n'
import { apiJson } from '../../backend/client'
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
let refreshId = 0
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
  ++refreshId
  try {
    const status = await apiJson<{ configured: string[] }>(
      '/plugins/leetcode/credentials',
      { action, site, ...(action === 'save' ? values : {}) },
      abort.signal,
    )
    if (props.site === site && !abort.signal.aborted) {
      clearDraft()
      configured.value = status.configured
      loading.value = false
      error.value = ''
      message.value =
        action === 'save' ? '登录信息已保存，后续提交立即使用新配置。' : '登录信息已清除。'
    }
  } catch {
    if (props.site === site && !abort.signal.aborted) {
      saveError.value = '操作未确认成功，请刷新状态后重试。'
    }
  } finally {
    saving.value = false
  }
}
const siteName = computed(() =>
  props.site === 'leetcode.cn' ? '中国站 · leetcode.cn' : '国际站 · leetcode.com',
)
const hasCredentials = computed(() => configured.value?.includes(props.site) === true)
async function refresh() {
  const id = ++refreshId
  loading.value = true
  error.value = ''
  try {
    const status = await apiJson<{ plugins: { id: string; configured?: string[] }[] }>(
      '/status',
      undefined,
      abort.signal,
    )
    if (id !== refreshId || abort.signal.aborted) return
    configured.value = status.plugins.find((plugin) => plugin.id === 'leetcode')?.configured ?? []
  } catch {
    if (id === refreshId && !abort.signal.aborted) {
      configured.value = undefined
      error.value = '无法读取连接状态，请检查服务。'
    }
  } finally {
    if (id === refreshId) loading.value = false
  }
}
watch(
  () => props.site,
  () => {
    clearDraft()
    void refresh()
  },
  { immediate: true },
)
onUnmounted(() => abort.abort())
</script>
<template>
  <section class="leetcode-connection" :aria-label="t(siteName)">
    <div class="connection-header">
      <div>
        <h3>{{ t(siteName) }}</h3>
        <p class="connection-status" role="status">
          {{ t('判题配置') }}
          <strong :class="{ configured: hasCredentials && !error && !loading }">{{
            t(
              loading
                ? '正在读取连接状态…'
                : error
                  ? '状态读取失败'
                  : hasCredentials
                    ? '已配置登录信息'
                    : '未配置登录信息',
            )
          }}</strong>
        </p>
      </div>
      <button type="button" class="button secondary" :disabled="loading || saving" @click="refresh">
        {{ t('刷新状态') }}
      </button>
    </div>
    <p v-if="error" class="import-warning" role="alert">{{ t(error) }}</p>
    <p v-else-if="!loading">
      {{
        t(
          hasCredentials
            ? '服务已保存该站点的登录信息，提交时会验证登录是否仍然有效。'
            : '可读取公开题目。提交判题前，请填写下方的登录信息。',
        )
      }}
    </p>
    <p>{{ t('打开力扣网站并登录，不会自动连接 Repeaty。判题使用服务端配置的账号。') }}</p>
    <a class="text-button" :href="`https://${site}/`" target="_blank" rel="noopener noreferrer"
      >{{ t('打开力扣网站') }} ↗</a
    >
    <fieldset class="connection-credentials" :disabled="saving || loading">
      <legend>{{ t(hasCredentials ? '更新登录信息' : '配置登录信息') }}</legend>
      <p class="form-note">
        {{ t('填写 Cookie 的值。保存后立即生效，无需重启服务；已保存的值不会回填。') }}
      </p>
      <div class="credential-fields" @keydown.enter.stop.prevent="configure('save')">
        <label :for="`${fieldId}-session`"
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
        <label :for="`${fieldId}-csrf`"
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
        {{ t('登录信息保存在此服务器，仅用于所选站点的判题，不包含在卡组导出中。') }}
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
