<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { t } from '../../i18n'
import { apiJson } from '../../backend/client'
import type { LeetCodeSite } from './model'
const props = defineProps<{ site: LeetCodeSite }>()
const configured = ref<string[]>()
const loading = ref(true)
const error = ref('')
const abort = new AbortController()
const siteName = computed(() =>
  props.site === 'leetcode.cn' ? '中国站 · leetcode.cn' : '国际站 · leetcode.com',
)
const prefix = computed(() => (props.site === 'leetcode.cn' ? 'LEETCODE_CN' : 'LEETCODE_COM'))
const hasCredentials = computed(() => configured.value?.includes(props.site) === true)
async function refresh() {
  loading.value = true
  error.value = ''
  try {
    const status = await apiJson<{ plugins: { id: string; configured?: string[] }[] }>(
      '/status',
      undefined,
      abort.signal,
    )
    configured.value = status.plugins.find((plugin) => plugin.id === 'leetcode')?.configured ?? []
  } catch {
    if (!abort.signal.aborted) {
      configured.value = undefined
      error.value = '无法读取连接状态，请检查服务。'
    }
  } finally {
    loading.value = false
  }
}
onMounted(refresh)
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
      <button type="button" class="button secondary" :disabled="loading" @click="refresh">
        {{ t('刷新状态') }}
      </button>
    </div>
    <p v-if="error" class="import-warning" role="alert">{{ t(error) }}</p>
    <p v-else-if="!loading">
      {{
        t(
          hasCredentials
            ? '服务已保存该站点的登录信息，提交时会验证登录是否仍然有效。'
            : '可读取公开题目。提交判题前，需要在 Repeaty 服务中配置该站点的登录信息。',
        )
      }}
    </p>
    <p>{{ t('打开力扣网站并登录，不会自动连接 Repeaty。判题使用服务端配置的账号。') }}</p>
    <a class="text-button" :href="`https://${site}/`" target="_blank" rel="noopener noreferrer"
      >{{ t('打开力扣网站') }} ↗</a
    >
    <details>
      <summary>{{ t('如何配置判题账号') }}</summary>
      <ol>
        <li>
          {{
            t(
              '在对应的力扣站点登录，在浏览器开发者工具的 Cookie 中找到 LEETCODE_SESSION 和 csrftoken。',
            )
          }}
        </li>
        <li>
          {{ t('在 Repeaty 服务的环境变量中设置：') }}
          <ul class="connection-variables">
            <li>
              <code>{{ prefix }}_SESSION</code> ← <code>LEETCODE_SESSION</code>
            </li>
            <li>
              <code>{{ prefix }}_CSRF</code> ← <code>csrftoken</code>
            </li>
          </ul>
        </li>
        <li>{{ t('重启 Repeaty 服务，然后点击「刷新状态」。登录过期后需要更新这两个值。') }}</li>
      </ol>
      <p class="form-note">
        {{ t('登录信息只放在服务的私密配置中，不要提交到 Git 或发到聊天中。') }}
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
