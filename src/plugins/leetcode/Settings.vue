<script setup lang="ts">
import { t } from '../../i18n'
import { defaultSite } from './model'
import Connection from './Connection.vue'
</script>
<template>
  <p class="form-note">
    {{ t('添加卡片时点击「添加 LeetCode 题目」，或将笔记类型设为「插件题目」。') }}
  </p>
  <Connection :site="defaultSite()" />
</template>
