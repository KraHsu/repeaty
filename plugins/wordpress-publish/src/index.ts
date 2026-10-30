import { h } from 'vue'
import { registerPage, registerSettings, locale, type ExtensionPlugin } from '@repeaty/plugin-api'
import PublishPage from '@repeaty/publishing-client/ui'
import ConnectionSettings from '@repeaty/publishing-client/settings'
import { createWordPress } from './client'

const t = (zh: string, en: string) => (locale.value === 'en' ? en : zh)
const icon = () =>
  h(
    'svg',
    {
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': 1.8,
      'aria-hidden': true,
    },
    [h('path', { d: 'M4 20h16M12 16V3m-5 5 5-5 5 5' })],
  )
export default function activate(): ExtensionPlugin {
  registerPage({
    id: 'publish',
    get title() {
      return t('WordPress 发布', 'WordPress publishing')
    },
    icon,
    component: (props: { workspaceScope: string }) =>
      h(PublishPage, { ...props, provider: 'wordpress', createAdapter: createWordPress }),
  })
  registerSettings({
    id: 'connection',
    title: 'WordPress',
    category: [
      {
        id: 'connections',
        get title() {
          return t('连接', 'Connections')
        },
      },
      { id: 'wordpress', title: 'WordPress' },
    ],
    component: () =>
      h(ConnectionSettings, { provider: 'wordpress', createAdapter: createWordPress }),
  })
  return {
    id: 'wordpress-publish',
    type: 'extension',
    kind: 'frontend',
    version: 1,
    get label() {
      return t('WordPress 发布', 'WordPress publishing')
    },
  }
}
