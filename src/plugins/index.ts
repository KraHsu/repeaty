import { defineAsyncComponent } from 'vue'
import type { CardView } from '../core/model'
import type { QuestionPlugin } from './types'

const flashcard: QuestionPlugin = {
  id: 'flashcard',
  label: '卡片',
  version: 1,
  showQuestion: defineAsyncComponent(() => import('./flashcard/Question.vue')),
  showAnswer: defineAsyncComponent(() => import('./flashcard/Answer.vue')),
}
// Plugins are bundled with the app. Backups contain data, never executable plugin code.
export const questionPlugins: QuestionPlugin[] = [flashcard]
const unavailable: QuestionPlugin = {
  id: 'unavailable',
  label: '插件题目',
  version: 1,
  showQuestion: defineAsyncComponent(() => import('./Unavailable.vue')),
  showAnswer: defineAsyncComponent(() => import('./Unavailable.vue')),
}
export function questionPlugin(card: Pick<CardView, 'type' | 'plugin'>): QuestionPlugin {
  if (card.type !== 'plugin') return flashcard
  return (
    questionPlugins.find(
      (plugin) => plugin.id === card.plugin?.id && plugin.version === card.plugin.version,
    ) ?? unavailable
  )
}
