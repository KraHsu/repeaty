import type { MaterialImportCandidate } from '@repeaty/plugin-api'
import type { DocumentBook } from './model'

export function candidates(
  book: DocumentBook,
  mode: 'free' | 'sequential',
): MaterialImportCandidate[] {
  const resources = book.resources.map((item) => ({
    path: item.path,
    blob: new Blob([new Uint8Array(item.bytes)], { type: item.type }),
  }))
  const base = { format: 'plain' as const, documentFormat: book.kind, readerId: 'documents' }
  if (book.kind === 'html') {
    const chapter = book.chapters[0]!
    return [
      {
        ...base,
        key: 'document',
        title: book.title.slice(0, 160),
        text: chapter.text,
        documentPath: chapter.path,
        resources,
        url: book.url,
        container: chapter.imageOnly,
      },
    ]
  }
  return [
    {
      ...base,
      key: 'book',
      title: book.title.slice(0, 160),
      text: `${book.title}\n\n${book.toc.map((item) => item.title).join('\n')}`,
      container: true,
      resources,
    },
    ...book.chapters.map((chapter, index) => ({
      ...base,
      key: `chapter-${index}`,
      title: chapter.title.slice(0, 160),
      text: chapter.text,
      parentKey: 'book',
      documentPath: chapter.path,
      resources: resources.filter((item) => chapter.resources.includes(item.path)),
      container: chapter.imageOnly,
      studySequence: chapter.imageOnly ? undefined : { groupKey: 'book', index, mode },
    })),
  ]
}
