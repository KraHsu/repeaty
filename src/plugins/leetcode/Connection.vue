<script setup lang="ts">
import { t } from '../../i18n'
import { Download } from '@lucide/vue'
import type { LeetCodeSite } from './model'
defineProps<{ site: LeetCodeSite }>()
const download = `${import.meta.env.BASE_URL}leetcode-connector.zip`
</script>
<template>
  <section class="leetcode-connection" :aria-label="t('连接 LeetCode')">
    <div class="connection-header">
      <div>
        <h3>{{ t('LeetCode 连接扩展') }}</h3>
        <p>{{ t('读取题目和提交判题需要安装扩展，支持桌面 Chrome / Edge。') }}</p>
      </div>
      <a class="button secondary" :href="download" download>
        <Download :size="18" aria-hidden="true" />{{ t('下载浏览器扩展') }}
      </a>
    </div>
    <details>
      <summary>{{ t('安装说明') }}</summary>
      <ol>
        <li>{{ t('下载并解压 ZIP 文件。') }}</li>
        <li>
          {{
            t(
              '打开浏览器扩展管理页：Chrome 使用 chrome://extensions，Edge 使用 edge://extensions。',
            )
          }}
        </li>
        <li>
          {{
            t('开启「开发者模式」，点击「加载已解压的扩展程序」，选择包含 manifest.json 的文件夹。')
          }}
        </li>
        <li>
          <a :href="`https://${site}/`" target="_blank" rel="noopener noreferrer">{{
            t('打开 LeetCode 并登录')
          }}</a
          >{{ t('，保留该标签页。') }}
        </li>
        <li>{{ t('刷新 Repeaty 后即可读取题目和提交代码。') }}</li>
      </ol>
      <p class="form-note">
        {{ t('提交代码会写入你的 LeetCode 提交记录。登录信息不会保存到 Repeaty 或备份中。') }}
      </p>
    </details>
  </section>
</template>
