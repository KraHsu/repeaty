import { registerWidget, type ExtensionPlugin } from '@repeaty/plugin-api'
import ReviewHeatmap from './ReviewHeatmap.vue'
import { text } from './text'

export default function activate(): ExtensionPlugin {
  registerWidget({
    id: 'daily-reviews',
    get title() {
      return text('title')
    },
    placement: 'overview.after-decks',
    component: ReviewHeatmap,
  })
  return {
    id: 'review-heatmap',
    type: 'extension',
    kind: 'frontend',
    get label() {
      return text('title')
    },
    get description() {
      return text('description')
    },
    version: 1,
  }
}
