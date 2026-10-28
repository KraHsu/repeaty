import { defineAsyncComponent, defineComponent } from 'vue'
import { registerSettings, type ReviewPanelPlugin } from '@repeaty/plugin-api'

export default function activate(): ReviewPanelPlugin {
  registerSettings({
    id: 'controls',
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
