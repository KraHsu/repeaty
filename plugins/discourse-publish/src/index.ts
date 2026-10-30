import { h } from 'vue'
import {
  registerPage,
  registerSettings,
  locale,
  onDispose,
  type ExtensionPlugin,
} from '@repeaty/plugin-api'
import PublishPage from '@repeaty/publishing-client/ui'
import ConnectionSettings from '@repeaty/publishing-client/settings'
import { createDiscourse } from './client'
import { createAuthorization } from './authorization'

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
    [h('path', { d: 'M21 11a8 8 0 0 1-8 8H5l-3 3V11a8 8 0 0 1 8-8h3a8 8 0 0 1 8 8Z' })],
  )
export default function activate(): ExtensionPlugin {
  const authorization = createAuthorization()
  onDispose(authorization.clear)
  registerPage({
    id: 'publish',
    get title() {
      return t('Discourse 发布', 'Discourse publishing')
    },
    icon,
    component: (props: { workspaceScope: string }) =>
      h(PublishPage, { ...props, provider: 'discourse', createAdapter: createDiscourse }),
  })
  registerSettings({
    id: 'connection',
    title: 'Discourse',
    category: [
      {
        id: 'connections',
        get title() {
          return t('连接', 'Connections')
        },
      },
      { id: 'discourse', title: 'Discourse' },
    ],
    component: () =>
      h(ConnectionSettings, {
        provider: 'discourse',
        createAdapter: createDiscourse,
        authorization,
      }),
  })
  return {
    id: 'discourse-publish',
    type: 'extension',
    kind: 'frontend',
    version: 1,
    get label() {
      return t('Discourse 发布', 'Discourse publishing')
    },
  }
}
