import { registerPage, type ExtensionPlugin } from '@repeaty/plugin-api'
import StatisticsPage from './StatisticsPage.vue'
import { text } from './text'

export default function activate(): ExtensionPlugin {
  registerPage({
    id: 'calendar',
    get title() {
      return text('title')
    },
    get description() {
      return text('description')
    },
    component: StatisticsPage,
  })
  return {
    id: 'study-statistics',
    type: 'extension',
    kind: 'frontend',
    version: 1,
    get label() {
      return text('title')
    },
    get description() {
      return text('description')
    },
  }
}
