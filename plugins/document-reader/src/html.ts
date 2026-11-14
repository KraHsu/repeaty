import { parse, type DefaultTreeAdapterMap } from 'parse5'
import { limits, type DocumentChapter, type DocumentResource } from './model'
import { resolvePath } from './path'

export type HtmlNode = DefaultTreeAdapterMap['node']
export const children = (node: HtmlNode): HtmlNode[] =>
  'childNodes' in node ? node.childNodes : []
export const tag = (node: HtmlNode) => ('tagName' in node ? node.tagName.toLowerCase() : '')
export const attr = (node: HtmlNode, name: string) =>
  'attrs' in node ? node.attrs.find((value) => value.name === name)?.value : undefined
export function walk(node: HtmlNode, visit: (node: HtmlNode) => void) {
  const queue = [node]
  let count = 0
  while (queue.length) {
    if (++count > limits.nodes) throw new Error('文档结构过于复杂。')
    const current = queue.pop()!
    visit(current)
    const next = children(current)
    for (let index = next.length - 1; index >= 0; index--) queue.push(next[index]!)
  }
}
export function find(root: HtmlNode, name: string) {
  const result: HtmlNode[] = []
  walk(root, (node) => {
    if (tag(node) === name) result.push(node)
  })
  return result
}
export function textOf(node: HtmlNode): string {
  let result = ''
  walk(node, (current) => {
    if ('value' in current && current.nodeName === '#text') result += current.value
  })
  return result
}
export function safeWebUrl(value: string | undefined) {
  try {
    const url = new URL(value ?? '')
    return ['https:', 'http:'].includes(url.protocol) ? url.href : undefined
  } catch {
    return undefined
  }
}
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!,
  )
const allowed = new Set(
  'p div section article main aside header footer h1 h2 h3 h4 h5 h6 span strong b em i u s del small sub sup mark q blockquote pre code br hr ul ol li dl dt dd table caption thead tbody tfoot tr th td figure figcaption a img audio source ruby rt rp math mrow mi mn mo mtext mfrac msqrt mroot msup msub msubsup munder mover munderover mtable mtr mtd semantics annotation'.split(
    ' ',
  ),
)
const removed = new Set(
  'script style iframe object embed form input button textarea select option template noscript svg canvas link meta base head'.split(
    ' ',
  ),
)
const blocks = new Set(
  'p div section article main aside header footer h1 h2 h3 h4 h5 h6 blockquote pre ul ol li dl dt dd table caption tr figure figcaption'.split(
    ' ',
  ),
)
const voids = new Set(['br', 'hr', 'img', 'source'])
function safeStyle(style: string | undefined) {
  if (!style) return ''
  return style
    .split(';')
    .map((item) => item.split(':').map((part) => part.trim().toLowerCase()))
    .filter(([name, value, extra]) => {
      if (!name || !value || extra !== undefined) return false
      if (name === 'text-align') return /^(left|right|center|justify|start|end)$/.test(value)
      if (name === 'font-weight') return /^(normal|bold|[1-9]00)$/.test(value)
      if (name === 'font-style') return /^(normal|italic|oblique)$/.test(value)
      if (name === 'text-decoration') return /^(none|underline|line-through)$/.test(value)
      if (name === 'vertical-align') return /^(baseline|sub|super|top|middle|bottom)$/.test(value)
      return false
    })
    .map(([name, value]) => `${name}:${value}`)
    .join(';')
}
function embeddedImage(value: string, path: string, index: number): DocumentResource | undefined {
  const match = /^data:(image\/(?:png|jpeg|gif|webp));base64,([a-z0-9+/=\s]+)$/i.exec(value)
  if (!match || match[2]!.length > limits.entryBytes * 1.4) return undefined
  try {
    const bytes = Uint8Array.from(atob(match[2]!.replace(/\s/g, '')), (letter) =>
      letter.charCodeAt(0),
    )
    if (!bytes.length || bytes.length > limits.entryBytes) return undefined
    return {
      path: `__embedded/${path}/image-${index}.${match[1]!.split('/')[1]}`,
      bytes,
      type: match[1]!.toLowerCase(),
    }
  } catch {
    return undefined
  }
}
export function cleanHtml(
  input: string,
  path: string,
  available: ReadonlySet<string>,
  fallbackTitle: string,
): { chapter: DocumentChapter; embedded: DocumentResource[]; url?: string; missing: string[] } {
  if (input.length > limits.entryBytes) throw new Error('HTML 章节超过大小限制。')
  const document = parse(input),
    titleNode = find(document, 'title')[0] ?? find(document, 'h1')[0],
    title = (titleNode ? textOf(titleNode).trim().slice(0, 200) : '') || fallbackTitle,
    body = find(document, 'body')[0] ?? document,
    resources = new Set<string>(),
    embedded: DocumentResource[] = [],
    missing = new Set<string>(),
    anchors: Record<string, number> = Object.create(null)
  let text = '',
    nodes = 0
  const append = (value: string) => {
    if (!value) return ''
    const start = text.length
    text += value
    if (text.length > limits.characters)
      throw new Error('单章正文超过 250,000 字符，请拆分后导入。')
    return `<span data-doc-start="${start}" data-doc-end="${text.length}">${escape(value)}</span>`
  }
  const line = () => (text && !text.endsWith('\n') ? append('\n') : '')
  const render = (node: HtmlNode, pre = false, depth = 0): string => {
    if (++nodes > limits.nodes || depth > 128) throw new Error('文档结构过于复杂。')
    if (node.nodeName === '#text' && 'value' in node)
      return append(pre ? node.value.replace(/\r\n?/g, '\n') : node.value.replace(/\s+/g, ' '))
    const name = tag(node)
    if (
      removed.has(name) ||
      attr(node, 'hidden') !== undefined ||
      /display\s*:\s*none/i.test(attr(node, 'style') ?? '')
    )
      return ''
    if (name === 'math') {
      const start = text.length
      const math = (item: HtmlNode, level: number): string => {
        if (++nodes > limits.nodes || level > 128) throw new Error('文档结构过于复杂。')
        if (item.nodeName === '#text' && 'value' in item) {
          text += item.value
          if (text.length > limits.characters)
            throw new Error('单章正文超过 250,000 字符，请拆分后导入。')
          return escape(item.value)
        }
        const element = tag(item)
        if (!allowed.has(element) || element === 'annotation') return ''
        return `<${element}>${children(item)
          .map((child) => math(child, level + 1))
          .join('')}</${element}>`
      }
      const content = math(node, depth)
      return `<span data-doc-start="${start}" data-doc-end="${text.length}">${content}</span>`
    }
    let prefix = blocks.has(name) ? line() : ''
    const id = attr(node, 'id')
    if (id && id.length <= 2048 && anchors[id] === undefined) anchors[id] = text.length
    if (name === 'br' || name === 'hr') return prefix + append('\n')
    const attributes: string[] = []
    const style = safeStyle(attr(node, 'style'))
    if (style) attributes.push(`style="${escape(style)}"`)
    const direction = attr(node, 'dir')
    if (direction && /^(rtl|ltr|auto)$/.test(direction)) attributes.push(`dir="${direction}"`)
    if (name === 'a') {
      const value = attr(node, 'href') ?? '',
        external = safeWebUrl(value),
        internal = resolvePath(path, value)
      if (external)
        attributes.push(`href="${escape(external)}" target="_blank" rel="noopener noreferrer"`)
      else if (internal)
        attributes.push(
          `data-doc-link="${escape(internal.path + (internal.fragment ? '#' + internal.fragment : ''))}" role="link" tabindex="0"`,
        )
    }
    if (name === 'img' || name === 'source' || (name === 'audio' && attr(node, 'src'))) {
      const value = attr(node, 'src') ?? '',
        image = name === 'img' ? embeddedImage(value, path, embedded.length) : undefined
      let resource = image?.path ?? resolvePath(path, value)?.path
      if (image) embedded.push(image)
      if (!resource || (!image && !available.has(resource))) {
        if (value) missing.add(value.slice(0, 300))
        const alt = attr(node, 'alt')?.trim()
        return prefix + (alt ? append(`[${alt}]`) : '')
      }
      resources.add(resource)
      attributes.push(`data-doc-resource="${escape(resource)}"`)
      if (name === 'img') attributes.push(`alt="${escape(attr(node, 'alt') ?? '')}" loading="lazy"`)
      if (name === 'img')
        for (const dimension of ['width', 'height']) {
          const value = Number(attr(node, dimension))
          if (Number.isInteger(value) && value > 0 && value <= 8192)
            attributes.push(`${dimension}="${value}"`)
        }
    }
    if (name === 'audio') attributes.push('controls preload="none"')
    if (['td', 'th'].includes(name)) {
      for (const field of ['rowspan', 'colspan']) {
        const value = Number(attr(node, field))
        if (Number.isInteger(value) && value > 1 && value <= 100)
          attributes.push(`${field}="${value}"`)
      }
    }
    if (name === 'ol') {
      const start = attr(node, 'start')
      if (start && /^-?\d{1,6}$/.test(start)) attributes.push(`start="${start}"`)
    }
    const content = children(node)
      .map((child) => render(child, pre || name === 'pre', depth + 1))
      .join('')
    if (!allowed.has(name)) return prefix + content
    const suffix = blocks.has(name) ? line() : ''
    prefix += `<${name}${attributes.length ? ' ' + attributes.join(' ') : ''}>`
    return prefix + (voids.has(name) ? '' : content + `</${name}>`) + suffix
  }
  let html = children(body)
    .map((node) => render(node))
    .join('')
  const imageOnly = !text.trim() && resources.size > 0
  if (imageOnly) html += `<p>${append(`[图片 / 音频文档：${title}]`)}</p>`
  if (!text.trim()) throw new Error('文档没有可读正文。')
  const canonical = find(document, 'link').find((node) =>
    attr(node, 'rel')?.split(/\s+/).includes('canonical'),
  )
  return {
    chapter: {
      path,
      title,
      text,
      html,
      resources: [...resources],
      anchors,
      ...(imageOnly ? { imageOnly: true } : {}),
    },
    embedded,
    url: safeWebUrl(canonical && attr(canonical, 'href')),
    missing: [...missing],
  }
}
