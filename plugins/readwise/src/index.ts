import {
  locale,
  registerSettings,
  registerSourceConnector,
  type ExtensionPlugin,
} from '@repeaty/plugin-api'
import Credentials from './Credentials.vue'
import { api } from './bridge'
import { scanExportDirectory } from './directory'

export default function activate(): ExtensionPlugin {
  registerSourceConnector({
    id: 'library',
    title: 'Readwise',
    kind: 'hybrid',
    fields: [
      {
        key: 'mode',
        title: '读取内容',
        type: 'select',
        default: 'both',
        options: [
          { value: 'both', label: '正文与高亮' },
          { value: 'reader', label: 'Reader 正文' },
          { value: 'highlights', label: 'Readwise 高亮' },
        ],
      },
    ],
    credentialHint: '在线读取前，请先到设置 → 连接 → Readwise 保存并测试 access token。',
    async scan(request, context) {
      if (request.directory) return scanExportDirectory(request.directory, context)
      const mode = request.settings.mode ?? 'both'
      if (mode !== 'reader' && mode !== 'highlights' && mode !== 'both')
        throw new Error('请选择 Readwise API 或授权导出目录。')
      return api.scan(mode, context)
    },
  })
  registerSettings({
    id: 'connection',
    title: 'Readwise',
    category: [
      {
        id: 'connections',
        get title() {
          return locale.value === 'en' ? 'Connections' : '连接'
        },
      },
      { id: 'readwise', title: 'Readwise' },
    ],
    component: Credentials,
  })
  return {
    id: 'readwise',
    kind: 'frontend',
    type: 'extension',
    version: 1,
    get label() {
      return locale.value === 'en' ? 'Readwise source' : 'Readwise 来源'
    },
    get description() {
      return locale.value === 'en'
        ? 'Collect Reader documents and highlights; review updates before accepting.'
        : '收集 Reader 正文与高亮，确认后采用来源更新。'
    },
  }
}
