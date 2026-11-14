import { locale, registerSourceConnector, type ExtensionPlugin } from '@repeaty/plugin-api'
import { scanVault } from './vault'

export default function activate(): ExtensionPlugin {
  registerSourceConnector({
    id: 'vault',
    get title() {
      return !locale.value.startsWith('zh') ? 'Obsidian vault' : 'Obsidian 笔记库'
    },
    kind: 'directory',
    async scan(request, context) {
      if (!request.directory) throw new Error('请先选择 Obsidian 笔记库目录。')
      return scanVault(request.directory, context)
    },
  })
  return {
    id: 'obsidian',
    kind: 'frontend',
    type: 'extension',
    version: 1,
    get label() {
      return !locale.value.startsWith('zh') ? 'Obsidian source' : 'Obsidian 来源'
    },
    get description() {
      return !locale.value.startsWith('zh')
        ? 'Read a vault without modifying notes or attachments.'
        : '只读连接笔记库，保留链接和附件，确认后采用更新。'
    },
  }
}
