import { defineAsyncComponent } from 'vue'
import type { FrontendPlugin } from '@repeaty/plugin-api'

export default {
  id: 'typed-answer',
  kind: 'frontend',
  label: 'Typed answer',
  version: 1,
  description: 'Type the answer before revealing it. Comparison ignores case and outer spaces.',
  showQuestion: defineAsyncComponent(() => import('./Question.vue')),
  showAnswer: defineAsyncComponent(() => import('./Answer.vue')),
  editor: defineAsyncComponent(() => import('./Editor.vue')),
} satisfies FrontendPlugin
