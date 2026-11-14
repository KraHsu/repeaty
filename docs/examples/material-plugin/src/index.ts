import {
  locale,
  materials,
  registerCommand,
  registerImporter,
  registerReader,
  registerSearchProvider,
  type ExtensionPlugin,
  type MaterialSearchHit,
} from '@repeaty/plugin-api'
import ChapterReader from './ChapterReader.vue'
import { parseStudyDocument } from './format'

export default () => {
  if (typeof registerImporter !== 'function' || typeof registerReader !== 'function')
    throw new Error('This plugin requires the Repeaty material SDK.')
  registerImporter({
    id: 'study-json',
    get title() {
      return locale.value === 'zh-CN' ? '学习章节文件' : 'Study chapter collection'
    },
    extensions: ['.study.json'],
    parse: parseStudyDocument,
  })
  registerReader({
    id: 'chapter',
    title: 'Study chapter reader',
    formats: ['study-json'],
    component: ChapterReader,
  })
  registerCommand({
    id: 'save-selection',
    title: locale.value === 'zh-CN' ? '把选区保存为摘录' : 'Save selection as excerpt',
    async run(context) {
      context.signal.throwIfAborted()
      if (!context.sourceId || !context.selection)
        throw new Error(
          locale.value === 'zh-CN' ? '请先选取章节文字。' : 'Select chapter text first.',
        )
      await materials.createExcerpt({
        sourceId: context.sourceId,
        selection: context.selection,
        title: context.selection.text.slice(0, 40),
        expectedRevision: context.expectedRevision,
        operationId: context.operationId,
      })
    },
  })
  registerSearchProvider({
    id: 'chapters',
    title: locale.value === 'zh-CN' ? '章节正文' : 'Chapter text',
    async search(query, context) {
      const snapshot = materials.snapshot(),
        needle = query.text.trim()
      if (!needle) return { hits: [] }
      const sources = snapshot.sources.filter(
        (source) =>
          source.document?.providerId === 'structured-study-example' &&
          source.document.format === 'study-json',
      )
      const cursor = query.cursor
        ? (JSON.parse(query.cursor) as { revision: number; offset: number; text: string })
        : undefined
      if (
        cursor &&
        (cursor.revision !== snapshot.revision ||
          cursor.text !== needle ||
          !Number.isInteger(cursor.offset) ||
          cursor.offset < 0)
      )
        throw new Error('Search changed; start a new search.')
      const hits: MaterialSearchHit[] = []
      let offset = cursor?.offset ?? 0
      // Small example only: bounded batches. A production provider should maintain a derived index.
      const end = Math.min(sources.length, offset + 100)
      for (; offset < end && hits.length < query.limit; offset++) {
        context.signal.throwIfAborted()
        const source = sources[offset]!,
          { text } = await materials.get(source.id, source.versionId)
        const start = text.indexOf(needle)
        if (start >= 0)
          hits.push({
            sourceId: source.id,
            versionId: source.versionId,
            title: source.title,
            snippet: text.slice(Math.max(0, start - 30), start + needle.length + 60),
            locator: {
              schemaVersion: 1,
              sourceId: source.id,
              versionId: source.versionId,
              kind: 'text',
              start,
              end: start + needle.length,
              quote: needle,
            },
          })
        await context.yield()
      }
      if (materials.snapshot().revision !== snapshot.revision)
        throw new Error('Search changed; start a new search.')
      return {
        hits,
        nextCursor:
          offset < sources.length
            ? JSON.stringify({ revision: snapshot.revision, offset, text: needle })
            : undefined,
      }
    },
  })
  return {
    id: 'structured-study-example',
    type: 'extension',
    kind: 'frontend',
    label: 'Structured Study',
    version: 1,
  } satisfies ExtensionPlugin
}
