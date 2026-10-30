import { h } from 'vue'
import { registerPage, registerSettings, type ExtensionPlugin } from '@repeaty/plugin-api'
import AssistantPage from './AssistantPage.vue'
import AssistantSettings from './AssistantSettings.vue'
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
      h('path', {
        d: 'M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-2 2V11.5A8.5 8.5 0 0 1 10.5 3h2A8.5 8.5 0 0 1 21 11.5Z',
      }),
      h('path', { d: 'M7 9h9M7 13h6' }),
    ],
  )
export default function activate(): ExtensionPlugin {
  registerPage({
    id: 'conversations',
    get title() {
      return t('学习助手', 'Learning assistant')
    },
    component: AssistantPage,
    icon,
  })
  registerSettings({
    id: 'connections',
    get title() {
      return t('学习助手', 'Learning assistant')
    },
    category: [
      {
        id: 'connections',
        get title() {
          return t('连接', 'Connections')
        },
      },
      {
        id: 'assistant',
        get title() {
          return t('学习助手', 'Learning assistant')
        },
      },
    ],
    component: AssistantSettings,
  })
  return {
    id: 'assistant',
    type: 'extension',
    kind: 'frontend',
    version: 1,
    get label() {
      return t('学习助手', 'Learning assistant')
    },
    get description() {
      return t(
        '围绕授权内容对话，确认后采用修改建议。',
        'Discuss authorized content and review changes before applying them.',
      )
    },
  }
}
