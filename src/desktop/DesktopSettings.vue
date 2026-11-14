<script setup lang="ts">
import { computed } from 'vue'
import { t } from '../i18n'
import { workspaceStatus } from './workspaces'
import { displayFilesystemPath } from './display-path'
import McpSettings from './McpSettings.vue'
import CaptureSettings from './CaptureSettings.vue'
import DesktopExperienceSettings from './DesktopExperienceSettings.vue'
import SyncSettings from './SyncSettings.vue'
import { SettingGroup } from '../components/ui'
defineProps<{ section?: 'workspace' | 'mcp' | 'capture' | 'experience' | 'sync' }>()
const path = computed(() => workspaceStatus.value?.active?.path)
</script>
<template>
  <SettingGroup v-if="!section || section === 'workspace'" :title="t('工作目录')">
    <p>{{ t('卡片、材料、附件和学习进度保存在同一个文件夹中。') }}</p>
    <p v-if="path" class="workspace-setting-path">{{ displayFilesystemPath(path) }}</p>
    <p>{{ t('在侧边栏“工作目录”中创建、打开或关闭学习库。') }}</p>
  </SettingGroup>
  <div v-if="!section || section === 'mcp'" :aria-label="t('桌面设置')" role="region">
    <McpSettings />
  </div>
  <CaptureSettings v-if="section === 'capture'" />
  <DesktopExperienceSettings v-if="section === 'experience'" />
  <SyncSettings v-if="section === 'sync'" />
</template>
<style scoped>
.workspace-setting-path {
  overflow-wrap: anywhere;
  font-family: var(--font-mono);
  font-size: var(--font-size-meta);
  padding: 0.75rem 1rem;
  margin: 1rem 0;
  background: var(--sage);
  border-radius: 8px;
}
</style>
