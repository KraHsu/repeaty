import { registerImporter, registerReader, type ExtensionPlugin } from '@repeaty/plugin-api'
import PdfReader from './PdfReader.vue'
import { importPdf } from './engine'

export default function activate(): ExtensionPlugin {
  registerImporter({ id: 'pdf', title: 'PDF 文档', extensions: ['.pdf'], parse: importPdf })
  registerReader({
    id: 'pdf',
    title: 'PDF 阅读器',
    formats: ['pdf'],
    supportsTextLocation: true,
    component: PdfReader,
  })
  return {
    id: 'pdf-reader',
    kind: 'frontend',
    type: 'extension',
    label: 'PDF 阅读器',
    version: 1,
    description: '离线保存 PDF 原件，按页阅读、搜索、选区制卡与复习回源。',
  }
}
