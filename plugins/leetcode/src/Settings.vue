<script setup lang="ts">
import { UiNotice } from '@repeaty/plugin-api'
import { t } from './i18n'
import Connection from './Connection.vue'
</script>
<template>
  <Connection site="leetcode.cn" />
  <Connection site="leetcode.com" />
  <UiNotice :title="t('添加题目')">
    {{ t('添加卡片时点击「添加 LeetCode 题目」，或将笔记类型设为「插件题目」。') }}
  </UiNotice>
</template>
