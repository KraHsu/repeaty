import { defineAsyncComponent } from 'vue'
export const SourcePanel = defineAsyncComponent(() => import('../components/SourcePanel.vue'))
export const MixedSession = defineAsyncComponent(() => import('../components/MixedSession.vue'))
export const PracticeHistoryPanel = defineAsyncComponent(
  () => import('../components/PracticeHistoryPanel.vue'),
)
export const SettingsPage = defineAsyncComponent(() => import('../components/SettingsPage.vue'))
