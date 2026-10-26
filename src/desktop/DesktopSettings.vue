<script setup lang="ts">
import { computed } from 'vue'
import { t } from '../i18n'
import { workspaceStatus } from './workspaces'
import McpSettings from './McpSettings.vue'
const path = computed(() => workspaceStatus.value?.active?.path)
</script>
<template>
  <section class="settings-section">
    <h2>{{ t('工作目录') }}</h2>
    <p>{{ t('卡片、材料、附件和学习进度保存在同一个文件夹中。') }}</p>
    <p v-if="path" class="workspace-setting-path">{{ path }}</p>
    <p>{{ t('在侧边栏“工作目录”中创建、打开或关闭学习库。') }}</p>
  </section>
  <div :aria-label="t('桌面设置')" role="region"><McpSettings /></div>
</template>
<style scoped>
.workspace-setting-path {
  overflow-wrap: anywhere;
  font-size: 1rem;
}
</style>
