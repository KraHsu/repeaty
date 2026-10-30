import { h } from 'vue'
import { registerPage, registerSettings, type ExtensionPlugin } from '@repeaty/plugin-api'
import PublishPage from './PublishPage.vue'
import PublishSettings from './PublishSettings.vue'
import { t } from './text'
const icon = () =>
  h(
    'svg',
    {
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': 1.8,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      'aria-hidden': true,
    },
    [
      h('rect', { x: 3, y: 4, width: 18, height: 16, rx: 2 }),
      h('path', { d: 'M3 9h18M7 6.5h.01M10 6.5h.01M9 13h6M9 16h4' }),
    ],
  )
export default function activate(): ExtensionPlugin {
  registerPage({
    id: 'site',
    get title() {
      return t('静态发布', 'Static publishing')
    },
    icon,
    component: PublishPage,
  })
  registerSettings({
    id: 'site',
    get title() {
      return t('静态发布', 'Static publishing')
    },
    category: [
      {
        id: 'tools',
        get title() {
          return t('工具', 'Tools')
        },
      },
      {
        id: 'publishing',
        get title() {
          return t('发布', 'Publishing')
        },
      },
    ],
    component: PublishSettings,
  })
  return {
    id: 'static-publish',
    kind: 'frontend',
    type: 'extension',
    version: 1,
    get label() {
      return t('静态发布', 'Static publishing')
    },
  }
}
