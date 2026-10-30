import { defineAsyncComponent, defineComponent, h, markRaw } from 'vue'
import { t } from '../i18n'
import type { SettingsEntry } from './types'
const AppearanceSettings = defineAsyncComponent(
  () => import('../components/AppearanceSettings.vue'),
)
const NavigationSettings = defineAsyncComponent(
  () => import('../components/NavigationSettings.vue'),
)
export function createAppearanceSettings(scope: () => string): SettingsEntry[] {
  const current = scope()
  const isCurrent = () => scope() === current
  return (
    [
      ['reading-appearance', '阅读与外观', 'appearance', '界面', AppearanceSettings],
      ['navigation', '侧栏与布局', 'navigation', '侧栏与布局', NavigationSettings],
    ] as const
  ).map(([id, title, categoryId, categoryTitle, component]) => ({
    ownerId: 'application',
    scope: current,
    isCurrent,
    standalone: true,
    contribution: {
      id,
      get title() {
        return t(title)
      },
      category: [
        {
          id: 'general',
          get title() {
            return t('通用')
          },
        },
        {
          id: categoryId,
          get title() {
            return t(categoryTitle)
          },
        },
      ],
      component: markRaw(
        defineComponent({ setup: () => () => (isCurrent() ? h(component, { isCurrent }) : null) }),
      ),
    },
  }))
}
