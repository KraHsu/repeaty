<script setup lang="ts">
import { computed, ref } from 'vue'
import { AppPage, locale, UiButton, UiNotice, type PluginPageProps } from '@repeaty/plugin-api'

defineProps<PluginPageProps>()
const count = ref(0)
const chinese = computed(() => locale.value === 'zh-CN')
</script>

<template>
  <AppPage
    :title="chinese ? '页面容器示例' : 'Shared page example'"
    :description="
      chinese ? '使用软件相同的标题、说明与操作区。' : 'Shared title, description, and actions.'
    "
  >
    <template #actions>
      <UiButton variant="secondary" @click="count = 0">{{ chinese ? '重置' : 'Reset' }}</UiButton>
      <UiButton variant="primary" @click="count++">{{ chinese ? '计数 +1' : 'Count +1' }}</UiButton>
    </template>
    <UiNotice>{{ chinese ? '当前计数' : 'Current count' }}: {{ count }}</UiNotice>
    <p class="page-example-help">
      {{
        chinese
          ? '计数只保存在本页。离开页面或切换学习库后会重新开始。'
          : 'The counter is local to this page and resets when you leave or switch libraries.'
      }}
    </p>
  </AppPage>
</template>

<style scoped>
.page-example-help {
  margin-block: 1rem;
  color: var(--ui-text-muted);
  line-height: var(--line-height-reading);
}
</style>
