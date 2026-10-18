import { defineAsyncComponent } from 'vue'
import type { QuestionPlugin } from '../types'

export default {
  id: 'leetcode',
  kind: 'local',
  label: 'LeetCode',
  version: 1,
  description: '将 LeetCode 题目加入卡组，编写代码并提交判题，按结果安排复习。',
  showQuestion: defineAsyncComponent(() => import('./Question.vue')),
  showAnswer: defineAsyncComponent(() => import('./Answer.vue')),
  editor: defineAsyncComponent(() => import('./Editor.vue')),
  settings: defineAsyncComponent(() => import('./Settings.vue')),
  history: defineAsyncComponent(() => import('./History.vue')),
} satisfies QuestionPlugin
