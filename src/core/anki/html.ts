import { parseFragment, type DefaultTreeAdapterTypes as Tree } from 'parse5'

export interface AnkiField {
  text: string
  media: { name: string; kind: 'image' | 'audio' }[]
  active: boolean
  external: boolean
}
const ignored = new Set([
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'svg',
  'math',
  'form',
  'input',
  'button',
  'textarea',
  'link',
  'meta',
  'template',
])
const blocks = new Set([
  'div',
  'p',
  'section',
  'article',
  'header',
  'footer',
  'blockquote',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
])
function escape(text: string): string {
  return text.replace(/[\\`*_[\]<>~|$]/g, '\\$&')
}
function textWithMath(text: string): string {
  let result = '',
    position = 0
  for (const match of text.matchAll(/\\\(([^]*?)\\\)|\\\[([^]*?)\\\]/g)) {
    result += escape(text.slice(position, match.index))
    result += match[1] !== undefined ? `$${match[1]}$` : `\n\n$$${match[2]}$$\n\n`
    position = match.index + match[0].length
  }
  return result + escape(text.slice(position))
}

/** Parse HTML as data, never through a browser document or a live element. */
export function convertAnkiHtml(html: string): AnkiField {
  if (html.length > 100_000) throw new Error('Anki field too large')
  const result: AnkiField = { text: '', media: [], active: false, external: false }
  function media(name: string, kind: 'image' | 'audio') {
    let normalized = name.trim()
    if (/^(?:[a-z][\w+.-]*:|\/\/|\/|\\)/i.test(normalized)) {
      result.external = true
      return ''
    }
    try {
      normalized = decodeURIComponent(normalized)
    } catch {
      /* literal filename */
    }
    if (
      !normalized ||
      /[/\\\u0000-\u001f]/.test(normalized) ||
      normalized === '.' ||
      normalized === '..'
    )
      throw new Error('Invalid media filename')
    result.media.push({ name: normalized.normalize('NFC'), kind })
    return ''
  }
  function text(node: Tree.Node): string {
    if ('value' in node) return node.value
    return 'childNodes' in node ? node.childNodes.map(text).join('') : ''
  }
  function visit(node: Tree.Node, depth = 0): string {
    if (depth > 100) throw new Error('Anki HTML nesting too deep')
    if (node.nodeName === '#text') {
      return textWithMath(
        (node as Tree.TextNode).value.replace(/\[sound:([^\]\r\n]+)\]/g, (_, name: string) =>
          media(name, 'audio'),
        ),
      )
    }
    if (!('tagName' in node)) return ''
    const tag = node.tagName
    if (ignored.has(tag)) {
      result.active = true
      return ''
    }
    if (node.attrs.some((attr) => /^on/i.test(attr.name))) result.active = true
    const attr = (name: string) => node.attrs.find((item) => item.name === name)?.value ?? ''
    if (tag === 'img') return media(attr('src'), 'image')
    if (tag === 'audio') {
      const source = node.childNodes.find(
        (child) => 'tagName' in child && child.tagName === 'source',
      ) as Tree.Element | undefined
      return media(
        attr('src') || source?.attrs.find((item) => item.name === 'src')?.value || '',
        'audio',
      )
    }
    if (tag === 'video' || tag === 'source') throw new Error('Unsupported media')
    if (tag === 'br') return '\n'
    if (tag === 'hr') return '\n\n---\n\n'
    if (tag === 'pre') {
      const content = text(node).replace(/\r\n?/g, '\n')
      const fence = '`'.repeat(
        Math.max(3, ...[...content.matchAll(/`+/g)].map((match) => match[0].length + 1)),
      )
      return `\n\n${fence}\n${content}\n${fence}\n\n`
    }
    if (tag === 'code') {
      const content = text(node),
        fence = '`'.repeat(
          Math.max(1, ...[...content.matchAll(/`+/g)].map((match) => match[0].length + 1)),
        )
      return `${fence} ${content} ${fence}`
    }
    const content = node.childNodes.map((child) => visit(child, depth + 1)).join('')
    if (tag === 'strong' || tag === 'b') return content.trim() ? `**${content}**` : content
    if (tag === 'em' || tag === 'i') return content.trim() ? `*${content}*` : content
    if (tag === 'li') return `\n- ${content.trim()}\n`
    if (tag === 'ul' || tag === 'ol') return `\n${content}\n`
    if (tag === 'td' || tag === 'th') return `${content.trim()} | `
    if (tag === 'tr') return `\n${content}\n`
    if (tag === 'table') return `\n\n${content}\n\n`
    if (tag === 'a') {
      const href = attr('href')
      if (/^https?:\/\/[^\s<>]+$/i.test(href))
        return `[${content || escape(href)}](<${href.replaceAll(')', '%29')}>)`
      return content
    }
    if (blocks.has(tag)) return `\n\n${content}\n\n`
    return content
  }
  const root = parseFragment(html)
  result.text = root.childNodes
    .map((node) => visit(node))
    .join('')
    .replace(/\u00a0/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  if (!result.text && result.media.length)
    result.text = result.media.map((item) => escape(item.name)).join('\n')
  return result
}
