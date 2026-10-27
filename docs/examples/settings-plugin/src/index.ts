import { defineAsyncComponent, defineComponent } from 'vue'
import type { ReviewPanelPlugin } from '@repeaty/plugin-api'

export default {
  id: 'settings-design-example',
  kind: 'frontend',
  label: 'Settings design example',
  description: 'Shared controls supplied by Repeaty, with no copied control styles.',
  version: 1,
  settings: defineAsyncComponent(() => import('./Settings.vue')),
  reviewPanel: defineComponent({ setup: () => () => null }),
} satisfies ReviewPanelPlugin
