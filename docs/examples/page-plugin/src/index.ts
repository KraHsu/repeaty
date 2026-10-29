import { locale, registerPage, registerWidget, type ExtensionPlugin } from '@repeaty/plugin-api'
import SharedPage from './SharedPage.vue'
import CustomPage from './CustomPage.vue'
import PageIcon from './PageIcon.vue'
import ReviewHeatmap from './ReviewHeatmap.vue'

export default () => {
  registerPage({
    id: 'shared',
    get title() {
      return locale.value === 'zh-CN' ? '页面容器示例' : 'Shared page example'
    },
    get description() {
      return locale.value === 'zh-CN'
        ? '使用软件相同的标题、说明与操作区。'
        : 'Shared title, description, and actions.'
    },
    icon: PageIcon,
    component: SharedPage,
  })
  registerPage({
    id: 'custom',
    get title() {
      return locale.value === 'zh-CN' ? '自定义布局示例' : 'Custom layout example'
    },
    component: CustomPage,
  })
  registerWidget({
    id: 'daily-reviews',
    get title() {
      return locale.value === 'zh-CN' ? '每日复习' : 'Daily reviews'
    },
    placement: 'overview.after-decks',
    component: ReviewHeatmap,
  })
  return {
    id: 'page-design-example',
    type: 'extension',
    kind: 'frontend',
    label: 'Page design example',
    version: 1,
  } satisfies ExtensionPlugin
}
