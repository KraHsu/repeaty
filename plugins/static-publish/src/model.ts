export interface PublicField {
  key: string
  values: string[]
}
export interface PublishSource {
  id: string
  versionId: string
  title: string
  text: string
  format: 'plain' | 'markdown'
  fields: PublicField[]
  resources: { reference: string; file: SiteFile }[]
  links?: { reference: string; sourceId: string; fragment?: string }[]
}
export interface SiteFile {
  path: string
  type: string
  bytes: Uint8Array
}
export interface SiteBinding {
  sourceId: string
  publicId: number
  versionId: string
  contentHash: string
  publishedAt: string
  updatedAt: string
  title: string
  active: boolean
}
export interface SiteIndex {
  version: 1
  nextId: number
  bindings: SiteBinding[]
}
export interface SiteTheme {
  page: string
  archive: string
  css: string
  script: string
}
export interface SiteOptions {
  title: string
  url: string
  description: string
  pageSize: number
}
export interface SiteBuild {
  files: SiteFile[]
  index: SiteIndex
  pages: { path: string; title: string }[]
  generatedAt: string
  fingerprint: string
}
export const limits = {
  sources: 500,
  sourceBytes: 4 * 1024 * 1024,
  totalBytes: 64 * 1024 * 1024,
  fileBytes: 8 * 1024 * 1024,
  themeBytes: 256 * 1024,
  files: 5000,
}
export const emptyIndex = (): SiteIndex => ({ version: 1, nextId: 1, bindings: [] })
export const encoder = new TextEncoder()
export function file(path: string, type: string, text: string): SiteFile {
  return { path, type, bytes: encoder.encode(text) }
}
export function validPath(path: string) {
  return (
    path.length > 0 &&
    path.length <= 240 &&
    !path.startsWith('/') &&
    !/[\\\u0000-\u001f?#:]/u.test(path) &&
    path.split('/').every((part) => part && part !== '.' && part !== '..')
  )
}
export async function hash(value: string | Uint8Array) {
  const bytes = typeof value === 'string' ? encoder.encode(value) : value
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes)))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
export function escape(value: unknown) {
  return String(value ?? '').replace(
    /[&<>"']/gu,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!,
  )
}
export function publicUrl(input: string) {
  if (!input.trim()) return 'https://example.invalid/'
  const url = new URL(input)
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
    throw new Error('站点地址须为不含查询参数的 HTTPS 地址。')
  return url.href.replace(/\/?$/u, '/')
}
