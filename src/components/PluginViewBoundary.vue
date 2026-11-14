<script setup lang="ts">
import { onBeforeUnmount, onErrorCaptured, ref, type Component } from 'vue'
import type { PluginReviewSummary } from '../plugins/activity'
import { t } from '../i18n'
import AppPage from './AppPage.vue'
import { UiButton, UiNotice } from './ui'

defineProps<{
  kind: 'page' | 'widget'
  title: string
  component: Component
  scope: string
  reviews?: readonly PluginReviewSummary[]
}>()
const failed = ref(false)
const attempt = ref(0)
let alive = true
onErrorCaptured(() => {
  if (alive) failed.value = true
  return false
})
onBeforeUnmount(() => {
  alive = false
})
function retry() {
  attempt.value++
  failed.value = false
}
</script>

<template>
  <AppPage v-if="failed && kind === 'page'" :title="title">
    <UiNotice tone="error">
      {{ t('插件页面暂时无法显示。') }}
      <template #actions
        ><UiButton @click="retry">{{ t('重新加载页面') }}</UiButton></template
      >
    </UiNotice>
  </AppPage>
  <UiNotice v-else-if="failed" tone="error" :title="title">
    {{ t('插件组件暂时无法显示。') }}
    <template #actions
      ><UiButton @click="retry">{{ t('重新加载组件') }}</UiButton></template
    >
  </UiNotice>
  <component
    v-else
    :is="component"
    :key="attempt"
    :workspace-scope="scope"
    v-bind="kind === 'widget' ? { reviews } : {}"
  />
</template>
