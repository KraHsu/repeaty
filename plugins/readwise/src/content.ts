import { parseFragment, type DefaultTreeAdapterMap } from 'parse5'
import type { SourceConnectorItem } from '@repeaty/plugin-api'

type Node = DefaultTreeAdapterMap['node']
export const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
export function string(value: unknown) {
  return typeof value === 'string' ? value : ''
}
export function safeUrl(value: unknown) {
  try {
    const url = new URL(string(value))
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
      ? url.href
      : undefined
  } catch {
    return undefined
  }
}
export function identity(value: unknown) {
  if (
    (typeof value !== 'string' && typeof value !== 'number') ||
    !String(value).trim() ||
    String(value).length > 160 ||
    /[\s\x00-\x1f]/.test(String(value))
  )
    throw new Error('Readwise 返回了无效的来源标识。')
  return String(value)
}
function escape(value: string) {
  return value.replace(/([\\`*_[\]<>])/g, '\\$1')
}
/** Produce inert Markdown without executing HTML or fetching embedded third-party assets. */
export function htmlToMarkdown(input: string, resource?: (url: string) => string | undefined) {
  if (input.length > 1024 * 1024) throw new Error('Readwise 正文超过 1 MiB。')
  const root = parseFragment(input)
  let nodes = 0
  const render = (node: Node, depth = 0, code = false): string => {
    if (++nodes > 80_000 || depth > 100) throw new Error('Readwise 正文结构过于复杂。')
    if (node.nodeName === '#text' && 'value' in node)
      return code ? node.value : escape(node.value.replace(/\s+/g, ' '))
    const tag = 'tagName' in node ? node.tagName : ''
    if (
      /^(script|style|iframe|object|embed|form|input|button|textarea|select|template|noscript|svg|canvas|head)$/.test(
        tag,
      )
    )
      return ''
    const attr = (name: string) =>
      'attrs' in node ? node.attrs.find((item) => item.name === name)?.value : undefined
    if (attr('hidden') !== undefined || /display\s*:\s*none/i.test(attr('style') || '')) return ''
    const children =
      'childNodes' in node
        ? node.childNodes
            .map((item) => render(item, depth + 1, code || tag === 'pre' || tag === 'code'))
            .join('')
        : ''
    if (/^h[1-6]$/.test(tag)) return `\n\n${'#'.repeat(Number(tag[1]))} ${children.trim()}\n\n`
    if (tag === 'pre') {
      const fence = '`'.repeat(
        Math.max(3, ...[...children.matchAll(/`+/g)].map((match) => match[0].length + 1)),
      )
      return `\n\n${fence}\n${children.trim()}\n${fence}\n\n`
    }
    if (tag === 'code' && !code) return `\`${children.replaceAll('`', 'ˋ')}\``
    if (tag === 'strong' || tag === 'b') return `**${children}**`
    if (tag === 'em' || tag === 'i') return `*${children}*`
    if (tag === 'br') return '\n'
    if (tag === 'hr') return '\n\n---\n\n'
    if (tag === 'li') return `\n- ${children.trim()}\n`
    if (tag === 'blockquote')
      return `\n\n${children
        .trim()
        .split('\n')
        .map((line) => `> ${line}`)
        .join('\n')}\n\n`
    if (tag === 'a') {
      const href = resource?.(attr('href') || '') ?? safeUrl(attr('href'))
      return href ? `[${children || escape(href)}](<${href.replaceAll('>', '%3E')}>)` : children
    }
    if (tag === 'img') {
      const src = resource?.(attr('src') || '')
      return src
        ? `![${escape(attr('alt') || '')}](${src})`
        : attr('alt')
          ? `［${escape(attr('alt')!)}］`
          : ''
    }
    if (tag === 'audio') {
      const source =
        'childNodes' in node
          ? node.childNodes.find((child) => 'tagName' in child && child.tagName === 'source')
          : undefined
      const sourceUrl =
        source && 'attrs' in source
          ? source.attrs.find((attribute) => attribute.name === 'src')?.value
          : undefined
      const src = resource?.(attr('src') || sourceUrl || '')
      return src ? `<audio controls src="${src}"></audio>` : children
    }
    if (/^(p|div|section|article|main|ul|ol|table|tr|figure|figcaption)$/.test(tag))
      return `\n\n${children.trim()}\n\n`
    if (tag === 'td' || tag === 'th') return `${children.trim()} · `
    return children
  }
  const text = render(root)
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  if (text.length > 250_000) throw new Error('Readwise 单篇正文超过 250,000 字符。')
  return text
}
export interface ReadwiseItem {
  key: string
  title: string
  text: string
  format: 'markdown'
  url?: string
  path?: string
  original?: SourceConnectorItem['original']
  resources?: SourceConnectorItem['resources']
}
function title(value: unknown) {
  return string(value).trim().slice(0, 160) || '未命名 Readwise 材料'
}
function quote(value: string) {
  return value
    .trim()
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n')
}
function highlights(entries: unknown[]) {
  return entries
    .filter((entry) => record(entry).is_deleted !== true)
    .map((entry) => {
      const item = record(entry)
      const text =
        string(item.text) || htmlToMarkdown(string(item.html_content)) || string(item.content)
      const note = string(item.note) || string(item.notes)
      return [
        quote(text),
        note ? `\n${escape(note)}` : '',
        safeUrl(item.readwise_url) ? `\n[查看高亮](<${safeUrl(item.readwise_url)}>)` : '',
      ]
        .join('')
        .trim()
    })
    .filter(Boolean)
    .join('\n\n')
}
/** Reader and v2 exports share external_id; one canonical Reader material owns both. */
export function convertReadwise(reader: unknown[], books: unknown[]) {
  const items = new Map<string, ReadwiseItem>()
  const deletedKeys = new Set<string>()
  const children = new Map<string, unknown[]>()
  for (const value of reader) {
    const item = record(value)
    if (!item.parent_id) continue
    const parent = identity(item.parent_id)
    const entries = children.get(parent) ?? []
    entries.push(value)
    children.set(parent, entries)
  }
  for (const value of reader) {
    const item = record(value)
    const id = identity(item.id)
    if (item.parent_id) continue
    const key = `reader:${id}`
    if (item.is_deleted === true) {
      deletedKeys.add(key)
      continue
    }
    const rawUrl = safeUrl(item.raw_source_url)
    const original =
      (item.category === 'pdf' || item.category === 'epub') && rawUrl?.startsWith('https://')
        ? {
            url: rawUrl,
            name: `${title(item.title).replace(/[\\/:*?"<>|\x00-\x1f]/g, '_')}.${item.category}`,
            format: item.category as 'pdf' | 'epub',
          }
        : undefined
    const body =
      htmlToMarkdown(string(item.html_content)) ||
      string(item.content) ||
      (original ? 'Readwise 未提供文字正文。获取原件后可使用文档阅读器阅读。' : '')
    const parts = [body, string(item.notes) ? `## 笔记\n\n${escape(string(item.notes))}` : '']
    const selected = highlights(children.get(id) ?? [])
    if (selected) parts.push(`## 高亮\n\n${selected}`)
    const text = parts.filter(Boolean).join('\n\n')
    if (!text)
      throw new Error(`Reader 未提供“${title(item.title)}”的正文，请检查 Readwise 中的解析状态。`)
    if (text.length > 250_000) throw new Error('Readwise 单篇正文超过 250,000 字符。')
    items.set(key, {
      key,
      title: title(item.title),
      text,
      format: 'markdown',
      url: safeUrl(item.source_url) ?? safeUrl(item.url),
      ...(original ? { original } : {}),
    })
  }
  for (const value of books) {
    const book = record(value)
    const key =
      book.source === 'reader' && book.external_id
        ? `reader:${identity(book.external_id)}`
        : `book:${identity(book.user_book_id)}`
    if (book.is_deleted === true) {
      if (!items.has(key)) deletedKeys.add(key)
      continue
    }
    if (!Array.isArray(book.highlights)) throw new Error('Readwise 高亮响应格式无效。')
    const selected = highlights(book.highlights)
    const existing = items.get(key)
    if (existing) {
      // Reader already includes its highlights. Only append the v2 export when Reader omitted them.
      if (selected && !existing.text.includes('\n\n## 高亮\n\n'))
        existing.text += `\n\n## 高亮\n\n${selected}`
    } else {
      const note = string(book.document_note)
      const text = [note ? `## 笔记\n\n${escape(note)}` : '', selected || '尚无高亮。']
        .filter(Boolean)
        .join('\n\n')
      items.set(key, {
        key,
        title: title(book.readable_title || book.title),
        text,
        format: 'markdown',
        url: safeUrl(book.source_url) ?? safeUrl(book.readwise_url),
      })
    }
  }
  for (const item of items.values()) {
    if (item.text.length > 250_000) throw new Error('Readwise 单篇正文超过 250,000 字符。')
    deletedKeys.delete(item.key)
  }
  if (items.size > 1000) throw new Error('Readwise 来源超过 1,000 篇，请缩小接入范围。')
  return {
    items: [...items.values()].sort((a, b) => a.key.localeCompare(b.key, 'en')),
    deletedKeys: [...deletedKeys],
    complete: true,
  }
}
