import { defineAsyncComponent } from 'vue'
import type { ReviewPanelPlugin } from '../types'

export default {
  id: 'review-history',
  kind: 'frontend',
  label: '答题历史',
  version: 1,
  description: '在当前卡片上方显示最近的评分，虚线圆表示本次作答。',
  reviewPanel: defineAsyncComponent(() => import('./Panel.vue')),
  settings: defineAsyncComponent(() => import('./Settings.vue')),
} satisfies ReviewPanelPlugin
