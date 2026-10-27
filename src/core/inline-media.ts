import MarkdownIt from 'markdown-it'
import { parseFragment, type DefaultTreeAdapterMap } from 'parse5'

export { inlineMediaSchema, type InlineMedia } from './inline-media-data'
const markdown = new MarkdownIt({ html: true })

/** Resolve a file reference without allowing URLs or traversal outside the workspace. */
export function mediaPath(url: string, documentPath: string): string | undefined {
  if (/^https?:\/\//i.test(url) || /^data:(image|audio)\//i.test(url) || url.startsWith('#'))
    return undefined
  const path = decodeURIComponent(url.split(/[?#]/, 1)[0]!)
  if (!path || /[\\:\u0000-\u001f]/.test(path) || path.startsWith('/'))
    throw new Error('unsafe-media-path')
  const parts = documentPath.split('/').slice(0, -1)
  for (const part of path.split('/')) {
    if (part === '..') {
      if (!parts.length) throw new Error('unsafe-media-path')
      parts.pop()
    } else if (part && part !== '.') parts.push(part)
  }
  return parts.join('/')
}
export function inlineReferences(text: string): { url: string; media: boolean }[] {
  const references: { url: string; media: boolean }[] = []
  function html(node: DefaultTreeAdapterMap['node']) {
    if ('tagName' in node && ['img', 'audio', 'source'].includes(node.tagName)) {
      const src = node.attrs.find((attr) => attr.name === 'src')?.value
      if (src) references.push({ url: src, media: true })
    }
    if ('childNodes' in node) node.childNodes.forEach(html)
  }
  function tokens(items: ReturnType<MarkdownIt['parse']>) {
    for (const token of items) {
      if (token.type === 'image' && token.attrGet('src'))
        references.push({ url: token.attrGet('src')!, media: true })
      if (token.type === 'link_open' && token.attrGet('href'))
        references.push({ url: token.attrGet('href')!, media: false })
      if (token.type === 'html_inline' || token.type === 'html_block')
        html(parseFragment(token.content))
      if (token.children) tokens(token.children)
    }
  }
  tokens(markdown.parse(text, {}))
  return references
}
export function localMediaReferences(text: string, path: string) {
  const refs = new Map<string, string>()
  for (const ref of inlineReferences(text)) {
    if (!ref.media) continue
    const resolved = mediaPath(ref.url, path)
    if (resolved === undefined) continue
    if (!resolved.startsWith('assets/')) throw new Error('unsafe-media-path')
    refs.set(ref.url, resolved)
    if (refs.size > 64) throw new Error('too-many-inline-media')
  }
  return refs
}
