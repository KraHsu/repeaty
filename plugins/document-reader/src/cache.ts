import type { DocumentBook } from './model'
let cached: { key: string; book: DocumentBook } | undefined
export function cachedBook(key: string) {
  return cached?.key === key ? cached.book : undefined
}
export function cacheBook(key: string, book: DocumentBook) {
  cached = { key, book }
}
export function clearCache() {
  cached = undefined
}
