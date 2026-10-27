import { t } from './i18n'
import { defineAsyncComponent } from 'vue'
import type { QuestionPlugin } from '@repeaty/plugin-api'

export default {
  id: 'leetcode',
  kind: 'local',
  get label() {
    return t('LeetCode')
  },
  createLabel: '添加 LeetCode 题目',
  version: 1,
  get description() {
    return t('将 LeetCode 题目加入卡组，编写代码并提交判题，按结果安排复习。')
  },
  showQuestion: defineAsyncComponent(() => import('./Question.vue')),
  showAnswer: defineAsyncComponent(() => import('./Answer.vue')),
  editor: defineAsyncComponent(() => import('./Editor.vue')),
  settings: defineAsyncComponent(() => import('./Settings.vue')),
  history: defineAsyncComponent(() => import('./History.vue')),
} satisfies QuestionPlugin
