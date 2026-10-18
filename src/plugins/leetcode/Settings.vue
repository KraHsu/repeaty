<script setup lang="ts">
import { t } from '../../i18n'
import { defaultSite } from './model'
import Connection from './Connection.vue'
</script>

<template>
  <p class="form-note">
    {{ t('添加卡片时点击「添加 LeetCode 题目」，或将笔记类型设为「插件题目」。') }}
  </p>
  <details class="plugin-connection-settings">
    <summary>{{ t('自动判题连接') }}</summary>
    <p class="form-note">
      {{
        t(
          'LeetCode 题型已内置。当前自动读取题目和提交判题使用单独的浏览器连接扩展；开启题型不会安装扩展。',
        )
      }}
    </p>
    <Connection :site="defaultSite()" />
  </details>
</template>
