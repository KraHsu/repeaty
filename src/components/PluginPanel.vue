<script setup lang="ts">
import { t } from '../i18n'
import { defaultSite } from '../plugins/leetcode/model'
import Connection from '../plugins/leetcode/Connection.vue'
</script>

<template>
  <div class="page plugins-page">
    <header class="page-heading">
      <h1>{{ t('插件') }}</h1>
    </header>
    <article class="plugin-settings">
      <div class="plugin-heading">
        <h2>LeetCode</h2>
        <span class="pill">{{ t('内置') }}</span>
      </div>
      <p>{{ t('将 LeetCode 题目加入卡组，编写代码并提交判题，按结果安排复习。') }}</p>
      <p class="form-note">
        {{ t('添加卡片时点击「添加 LeetCode 题目」，或将笔记类型设为「插件题目」。') }}
      </p>
      <Connection :site="defaultSite()" />
    </article>
  </div>
</template>
