<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { t } from '../../i18n'
import { apiJson } from '../../backend/client'
import type { LeetCodeSite } from './model'
defineProps<{ site: LeetCodeSite }>()
const configured = ref<string[]>()
const error = ref('')
onMounted(async () => {
  try {
    const status = await apiJson<{ plugins: { id: string; configured?: string[] }[] }>('/status')
    configured.value = status.plugins.find((plugin) => plugin.id === 'leetcode')?.configured ?? []
  } catch {
    error.value = '无法读取连接状态，请检查服务。'
  }
})
</script>
<template>
  <section class="leetcode-connection" :aria-label="t('连接 LeetCode')">
    <div class="connection-header">
      <div>
        <h3>{{ t('LeetCode 判题服务') }}</h3>
        <p v-if="configured">
          {{
            t(
              configured.includes(site)
                ? '该站点已配置判题连接。'
                : '该站点尚未配置登录信息。可读取公开题目，提交判题需要部署者完成配置。',
            )
          }}
        </p>
        <p v-else>{{ t(error || '正在读取连接状态…') }}</p>
      </div>
      <a
        class="button secondary"
        :href="`https://${site}/`"
        target="_blank"
        rel="noopener noreferrer"
        >{{ t('在 LeetCode 打开') }}</a
      >
    </div>
    <p class="form-note">
      {{
        t('提交使用部署者配置的 LeetCode 账号，并写入该账号的提交记录。登录信息只保留在服务端。')
      }}
    </p>
  </section>
</template>
