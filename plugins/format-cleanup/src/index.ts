import { defineComponent, h } from 'vue'
import { registerPage, registerSettings, type ExtensionPlugin } from '@repeaty/plugin-api'
import CleanupPage from './CleanupPage.vue'
import RuleSettings from './RuleSettings.vue'
import { createCleanupSettings } from './settings'
import { text } from './text'

export default function activate(): ExtensionPlugin {
  const settings = createCleanupSettings()
  registerPage({
    id: 'cleanup',
    get title() {
      return text('格式清理')
    },
    get description() {
      return text('预览规则后清理材料正文')
    },
    component: defineComponent({
      props: { workspaceScope: { type: String, required: true } },
      setup: (props) => () => h(CleanupPage, { workspaceScope: props.workspaceScope, settings }),
    }),
  })
  registerSettings({
    id: 'cleanup-rules',
    get title() {
      return text('格式清理')
    },
    category: [
      {
        id: 'tools',
        get title() {
          return text('工具')
        },
      },
      {
        id: 'format-cleanup',
        get title() {
          return text('格式清理')
        },
      },
    ],
    component: defineComponent({ setup: () => () => h(RuleSettings, { settings }) }),
  })
  return {
    id: 'format-cleanup',
    kind: 'frontend',
    type: 'extension',
    get label() {
      return text('格式清理')
    },
    version: 1,
    get description() {
      return text('保护代码与链接，预览差异后应用可撤销的正文清理。')
    },
  }
}
