import { registerImporter, registerReader, type ExtensionPlugin } from '@repeaty/plugin-api'
import DocumentReader from './DocumentReader.vue'
import { candidates } from './import'
import { readDocument } from './worker'
import { clearCache } from './cache'

export default function createPlugin(): ExtensionPlugin {
  const dispose = [
    ...(['free', 'sequential'] as const).map((mode) =>
      registerImporter({
        id: `epub-${mode}`,
        title: mode === 'free' ? 'EPUB · 自由阅读' : 'EPUB · 顺序阅读',
        extensions: ['.epub'],
        async parse(file, context) {
          return candidates(await readDocument(file, 'epub', file.name, context), mode)
        },
      }),
    ),
    registerImporter({
      id: 'html',
      title: 'HTML · 网页文件',
      extensions: ['.html', '.htm', '.xhtml'],
      async parse(file, context) {
        return candidates(
          await readDocument(file, 'html', file.webkitRelativePath || file.name, context),
          'free',
        )
      },
    }),
    registerReader({
      id: 'documents',
      title: 'EPUB / HTML 阅读器',
      formats: ['epub', 'html'],
      supportsTextLocation: true,
      component: DocumentReader,
    }),
  ]
  return {
    id: 'document-reader',
    kind: 'frontend',
    type: 'extension',
    label: 'EPUB 与 HTML 阅读',
    version: 1,
    dispose: () => {
      clearCache()
      dispose.reverse().forEach((stop) => stop())
    },
  }
}
