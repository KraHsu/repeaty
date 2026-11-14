export interface DocumentResource {
  path: string
  bytes: Uint8Array
  type: string
}
export interface DocumentChapter {
  path: string
  title: string
  text: string
  html: string
  resources: string[]
  anchors: Record<string, number>
  imageOnly?: boolean
}
export interface DocumentBook {
  kind: 'epub' | 'html'
  title: string
  url?: string
  chapters: DocumentChapter[]
  toc: { title: string; path: string; fragment?: string; depth: number }[]
  resources: DocumentResource[]
  warnings: string[]
}
export interface RelatedFile {
  path: string
  bytes: Uint8Array
  type: string
}
export const limits = {
  fileBytes: 32 * 1024 * 1024,
  totalBytes: 64 * 1024 * 1024,
  entryBytes: 8 * 1024 * 1024,
  entries: 5000,
  chapters: 99,
  characters: 250_000,
  nodes: 100_000,
  resources: 512,
}
