<script setup lang="ts">
import { t } from '../../i18n'
import type { LeetCodeSite } from './model'
defineProps<{ site: LeetCodeSite }>()
const download = `${import.meta.env.BASE_URL}leetcode-connector.zip`
</script>
<template>
  <details class="leetcode-connection">
    <summary>{{ t('连接 LeetCode') }}</summary>
    <ol>
      <li>
        <a :href="download" download>{{ t('下载浏览器扩展') }}</a
        >{{ t('，解压后在 Chrome / Edge 的扩展页面开启开发者模式，选择“加载已解压的扩展程序”。') }}
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
</template>
