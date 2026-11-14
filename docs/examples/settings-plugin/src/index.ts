import { defineAsyncComponent, defineComponent } from 'vue'
import { registerSettings, t, type ReviewPanelPlugin } from '@repeaty/plugin-api'

export default function activate(): ReviewPanelPlugin {
  registerSettings({
    id: 'controls',
    category: [
      {
        id: 'general',
        get title() {
          return t('通用')
        },
      },
      {
        id: 'example',
        get title() {
          return t('控件示例')
        },
      },
    ],
    title: 'Settings design example',
    description: 'Shared controls supplied by Repeaty, with no copied control styles.',
    component: defineAsyncComponent(() => import('./Settings.vue')),
  })
  return {
    id: 'settings-design-example',
    kind: 'frontend',
    label: 'Settings design example',
    description: 'Shared controls supplied by Repeaty, with no copied control styles.',
    version: 1,
    reviewPanel: defineComponent({ setup: () => () => null }),
  } satisfies ReviewPanelPlugin
}
