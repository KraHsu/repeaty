import MarkdownIt from 'markdown-it'
import hljs from 'highlight.js/lib/common'
import katex from 'katex'
import { parseFragment, type DefaultTreeAdapterMap } from 'parse5'
import { escape, type PublishSource } from './model'

type Node = DefaultTreeAdapterMap['node']
const allowed = new Set(
  'p div section article h1 h2 h3 h4 h5 h6 span strong b em i u s del small sub sup mark q blockquote pre code br hr ul ol li dl dt dd table caption thead tbody tfoot tr th td figure figcaption a img audio video source ruby rt rp details summary math mrow mi mn mo mtext mfrac msqrt mroot msup msub msubsup munder mover munderover mtable mtr mtd semantics annotation mspace menclose mpadded mphantom'.split(
    ' ',
  ),
)
const removed = new Set(
  'script style iframe object embed form input button textarea select option template noscript svg canvas link meta base head'.split(
    ' ',
  ),
)
const voids = new Set(['br', 'hr', 'img', 'source', 'mspace'])
const tag = (node: Node) => ('tagName' in node ? node.tagName : '')
const children = (node: Node): Node[] => ('childNodes' in node ? node.childNodes : [])
const attr = (node: Node, name: string) =>
  'attrs' in node ? node.attrs.find((item) => item.name === name)?.value : undefined
const slug = (value: string) =>
  value
    .toLocaleLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}_\s-]/gu, '')
    .replace(/\s+/gu, '-')
    .slice(0, 140) || 'section'
function style(value = '') {
  return value
    .split(';')
    .map((part) => part.split(':').map((word) => word.trim()))
    .filter(([key, content, rest]) => {
      if (!key || !content || rest !== undefined) return false
      if (key === 'text-align') return /^(left|right|center|justify|start|end)$/u.test(content)
      if (key === 'font-weight') return /^(normal|bold|[1-9]00)$/u.test(content)
      if (key === 'font-style') return /^(normal|italic|oblique)$/u.test(content)
      if (key === 'text-decoration') return /^(none|underline|line-through)$/u.test(content)
      if (key === 'color' || key === 'background-color')
        return /^(#[\da-f]{3,8}|[a-z]{3,20})$/iu.test(content)
      return false
    })
    .map(([key, value]) => `${key}:${value}`)
    .join(';')
}
export function cleanHtml(
  html: string,
  resolve: (value: string, asset: boolean) => string | undefined,
): string {
  let nodes = 0
  function render(node: Node, depth: number): string {
    if (++nodes > 150_000 || depth > 128) throw new Error('材料结构过于复杂，请拆分后发布。')
    if (node.nodeName === '#text' && 'value' in node) return escape(node.value)
    const name = tag(node)
    if (removed.has(name)) return ''
    const body = children(node)
      .map((child) => render(child, depth + 1))
      .join('')
    if (!allowed.has(name)) return body
    const attrs: string[] = []
    const classes = attr(node, 'class')
      ?.split(/\s+/u)
      .filter((item) => /^(hljs(?:-[\w-]+)?|language-[\w-]+|katex|math-display)$/u.test(item))
      .join(' ')
    if (classes) attrs.push(`class="${classes}"`)
    const inline = style(attr(node, 'style'))
    if (inline) attrs.push(`style="${escape(inline)}"`)
    const id = attr(node, 'id')
    if (id && /^[\p{L}\p{N}_-]{1,150}$/u.test(id)) attrs.push(`id="${escape(id)}"`)
    if (name === 'a') {
      const url = resolve(attr(node, 'href') ?? '', false)
      if (url) attrs.push(`href="${escape(url)}" rel="noopener noreferrer"`)
    }
    if (['img', 'audio', 'video', 'source'].includes(name)) {
      const url = resolve(attr(node, 'src') ?? '', true)
      if (!url) return name === 'img' ? escape(attr(node, 'alt') ?? '') : body
      attrs.push(`src="${escape(url)}"`)
      if (name === 'img') attrs.push(`alt="${escape(attr(node, 'alt') ?? '')}" loading="lazy"`)
      if (name === 'audio' || name === 'video') attrs.push('controls preload="none"')
    }
    if (name === 'math')
      attrs.push(
        'xmlns="http://www.w3.org/1998/Math/MathML"',
        `display="${attr(node, 'display') === 'block' ? 'block' : 'inline'}"`,
      )
    if (name === 'annotation' && attr(node, 'encoding') === 'application/x-tex')
      attrs.push('encoding="application/x-tex"')
    for (const key of ['colspan', 'rowspan', 'start']) {
      const value = attr(node, key)
      if (value && /^\d{1,3}$/u.test(value)) attrs.push(`${key}="${value}"`)
    }
    const opening = `<${name}${attrs.length ? ' ' + attrs.join(' ') : ''}>`
    return opening + (voids.has(name) ? '' : body + `</${name}>`)
  }
  return render(parseFragment(html), 0)
}

export function renderSource(
  source: PublishSource,
  paths: ReadonlyMap<string, string>,
  titles: ReadonlyMap<string, string>,
  depth: string,
) {
  const assets = new Map(source.resources.map((item) => [item.reference, depth + item.file.path]))
  const links = new Map(
    (source.links ?? []).map((item) => [
      item.reference,
      paths.get(item.sourceId)
        ? depth +
          paths.get(item.sourceId)! +
          (item.fragment ? '#' + encodeURIComponent(slug(item.fragment)) : '')
        : '',
    ]),
  )
  const resolve = (value: string, asset: boolean): string | undefined => {
    if (assets.has(value)) return assets.get(value)
    if (!asset && links.has(value)) return links.get(value) || undefined
    try {
      const decoded = decodeURI(value)
      if (assets.has(decoded)) return assets.get(decoded)
      if (!asset && links.has(decoded)) return links.get(decoded) || undefined
    } catch {
      /* Invalid URI escapes are not projected. */
    }
    if (!asset && value.startsWith('#')) return value
    if (asset && /^(?:https?:)?\/\//iu.test(value))
      throw new Error('材料包含外部图片或媒体。请先把需要公开的媒体导入为本地附件，再生成站点。')
    if (!asset && /^(https?:|mailto:)/iu.test(value)) {
      try {
        const url = new URL(value)
        return !url.username && !url.password ? url.href : undefined
      } catch {
        return undefined
      }
    }
    return undefined
  }
  const markdown = new MarkdownIt({
    html: true,
    linkify: false,
    breaks: true,
    highlight(code, language) {
      return language && hljs.getLanguage(language)
        ? `<pre><code class="hljs language-${escape(language)}">${hljs.highlight(code, { language, ignoreIllegals: true }).value}</code></pre>`
        : ''
    },
  })
  markdown.validateLink = (value) => !/^(javascript|vbscript|data):/iu.test(value)
  markdown.inline.ruler.before('escape', 'public_wiki', (state, silent) => {
    if (state.src.slice(state.pos, state.pos + 2) !== '[[') return false
    const end = state.src.indexOf(']]', state.pos + 2)
    if (end < 0 || end - state.pos > 1000) return false
    const [target = '', alias] = state.src.slice(state.pos + 2, end).split('|')
    const [destination = '', fragment] = target.split('#')
    const sourceId = destination.startsWith('source:')
      ? (() => {
          try {
            return decodeURIComponent(destination.slice(7))
          } catch {
            return ''
          }
        })()
      : titles.get(destination.trim())
    if (!silent) {
      const token = state.push('html_inline', '', 0)
      const label = alias || (target.startsWith('source:') ? '相关材料' : target)
      token.content =
        sourceId && paths.has(sourceId)
          ? `<a href="${escape(depth + paths.get(sourceId)! + (fragment ? '#' + encodeURIComponent(slug(fragment)) : ''))}">${escape(label)}</a>`
          : escape(label)
    }
    state.pos = end + 2
    return true
  })
  markdown.inline.ruler.before('escape', 'public_math', (state, silent) => {
    const source = state.src.slice(state.pos)
    const delimiter = source.startsWith('$$')
      ? '$$'
      : source.startsWith('\\(')
        ? '\\('
        : source.startsWith('\\[')
          ? '\\['
          : source.startsWith('$') && !/\s/u.test(source[1] ?? '')
            ? '$'
            : ''
    if (!delimiter) return false
    const closing = delimiter === '\\(' ? '\\)' : delimiter === '\\[' ? '\\]' : delimiter
    const end = source.indexOf(closing, delimiter.length)
    if (end < 0 || end > 20_000) return false
    if (!silent) {
      const token = state.push('html_inline', '', 0)
      token.content = katex.renderToString(source.slice(delimiter.length, end), {
        output: 'mathml',
        displayMode: delimiter === '$$' || delimiter === '\\[',
        throwOnError: false,
        trust: false,
        maxExpand: 500,
        strict: 'ignore',
      })
    }
    state.pos += end + closing.length
    return true
  })
  const headings = new Map<string, number>()
  markdown.renderer.rules.heading_open = (tokens, index, options, _env, self) => {
    const name = slug(tokens[index + 1]?.content ?? '')
    const count = headings.get(name) ?? 0
    headings.set(name, count + 1)
    tokens[index]!.attrSet('id', name + (count ? '-' + count : ''))
    return self.renderToken(tokens, index, options)
  }
  // Only paths generated in this site may survive a second pass through the HTML cleaner.
  const publicPaths = new Set([...paths.values()].map((path) => depth + path))
  return cleanHtml(
    source.format === 'plain'
      ? `<p>${escape(source.text).replaceAll('\n', '<br>')}</p>`
      : markdown.render(source.text),
    (value, asset) =>
      !asset && publicPaths.has(value.split('#')[0]!) ? value : resolve(value, asset),
  )
}
