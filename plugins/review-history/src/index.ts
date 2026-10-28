import { t } from './i18n'
import { defineAsyncComponent } from 'vue'
import type { ReviewPanelPlugin } from '@repeaty/plugin-api'

export default {
  id: 'review-history',
  kind: 'frontend',
  get label() {
    return t('答题历史')
  },
  version: 1,
  get description() {
    return t('复习时查看当前卡片的评分记录。')
  },
  reviewPanel: defineAsyncComponent(() => import('./Panel.vue')),
  settings: defineAsyncComponent(() => import('./Settings.vue')),
} satisfies ReviewPanelPlugin
