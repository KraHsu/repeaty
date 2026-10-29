import { t } from '../i18n'
import MarkdownIt from 'markdown-it'
import katex from 'katex'
import hljs from 'highlight.js/lib/common'
import { cleanHtml, contentScope, wrapHtml } from './rich-html'
import {
  installReadingMapping,
  attachReadingOrigins,
  readingTextSpans,
  readingCodeHtml,
} from './reading-markdown-map'
import { installWikiLinks } from './wiki-links'

const markdown = new MarkdownIt({
  html: true,
  breaks: true,
  linkify: false,
  highlight(code, language) {
    // Explicit languages only: auto-detection is costly and surprising on prose.
    if (!language || code.length > 100_000 || !hljs.getLanguage(language.toLowerCase())) return ''
    return hljs.highlight(code, { language: language.toLowerCase(), ignoreIllegals: true }).value
  },
})
// CommonMark treats punctuation before ** followed by Chinese as an opening
// delimiter. Accept it as a closer and render the separating space the user
// would otherwise have to type. Tokenize in place: code, URLs, math, escaped
// markers, stored text and reading-source offsets stay untouched.
markdown.inline.ruler.before('emphasis', 'cjk_strong_spacing', (state, silent) => {
  if (silent || !state.src.startsWith('**', state.pos)) return false
  const scanned = state.scanDelims(state.pos, true)
  const before = state.src[state.pos - 1] ?? '',
    after = state.src[state.pos + 2] ?? ''
  if (
    scanned.length !== 2 ||
    scanned.can_close ||
    !/[\p{P}\p{S}]/u.test(before) ||
    !/[\p{L}\p{N}]/u.test(after) ||
    !(/[\u3000-\u303f\uff00-\uffef]/u.test(before) || /\p{Script=Han}/u.test(after)) ||
    !state.delimiters.some(
      (delimiter) => delimiter.marker === 42 && delimiter.open && delimiter.length >= 2,
    )
  )
    return false
  for (let i = 0; i < 2; i++) {
    const token = state.push('text', '', 0)
    token.content = '*'
    token.meta = { cjkSpacing: true }
    state.delimiters.push({
      marker: 42,
      length: 2,
      token: state.tokens.length - 1,
      end: -1,
      open: false,
      close: true,
    })
  }
  state.pos += 2
  return true
})
markdown.renderer.rules.strong_close = (tokens, index, options, _env, renderer) =>
  renderer.renderToken(tokens, index, options) + (tokens[index]!.meta?.cjkSpacing ? ' ' : '')
// Attachments are stored locally; Markdown images never trigger remote requests.
markdown.renderer.rules.image = (tokens, index, _options, env) => {
  const token = tokens[index]!,
    src = token.attrGet('src') ?? ''
  return env.resources?.has(src)
    ? `<img src="${markdown.utils.escapeHtml(src)}" alt="${markdown.utils.escapeHtml(token.content)}" loading="lazy">`
    : `<span class="media-placeholder">${markdown.utils.escapeHtml(t('[图片：{name} · 请使用附件]', { name: token.content }))}</span>`
}
const linkOpen = markdown.renderer.rules.link_open
markdown.renderer.rules.link_open = (tokens, index, options, env, renderer) => {
  tokens[index]!.attrSet('target', '_blank')
  tokens[index]!.attrSet('rel', 'noopener noreferrer')
  return linkOpen
    ? linkOpen(tokens, index, options, env, renderer)
    : renderer.renderToken(tokens, index, options)
}
function formula(source: string, displayMode: boolean): string {
  return katex.renderToString(source, {
    displayMode,
    throwOnError: false,
    trust: false,
    strict: 'error',
    maxSize: 20,
    maxExpand: 1000,
  })
}
markdown.inline.ruler.before('escape', 'math', (state, silent) => {
  const rest = state.src.slice(state.pos)
  const delimiter = ['$$', '\\(', '\\[', '$'].find((marker) => rest.startsWith(marker))
  if (!delimiter) return false
  const display = delimiter === '$$' || delimiter === '\\['
  const closing = delimiter === '\\(' ? '\\)' : delimiter === '\\[' ? '\\]' : delimiter
  const start = state.pos + delimiter.length
  if (delimiter === '$' && /\s/.test(state.src[start] ?? ' ')) return false
  let end = start
  while ((end = state.src.indexOf(closing, end)) !== -1) {
    let slashes = 0
    for (let i = end - 1; i >= start && state.src[i] === '\\'; i--) slashes++
    if (slashes % 2 === 0) break
    end += closing.length
  }
  if (
    end < 0 ||
    end === start ||
    (delimiter === '$' &&
      (/\s/.test(state.src[end - 1]!) || state.src.slice(start, end).includes('\n')))
  )
    return false
  if (!silent) {
    const token = state.push('math', '', 0)
    token.content = state.src.slice(start, end)
    token.meta = { display }
  }
  state.pos = end + closing.length
  return true
})
markdown.renderer.rules.math = (tokens, index) =>
  formula(tokens[index]!.content, tokens[index]!.meta.display)
markdown.block.ruler.before('fence', 'math_block', (state, start, end, silent) => {
  const line = (n: number) =>
    state.src.slice(state.bMarks[n]! + state.tShift[n]!, state.eMarks[n]!).trim()
  const opening = ['$$', '\\['].find((marker) => line(start).startsWith(marker))
  if (state.sCount[start]! - state.blkIndent >= 4 || !opening) return false
  const closing = opening === '$$' ? '$$' : '\\]'
  const first = line(start).slice(2)
  let next = start + 1,
    content = first
  if (first.endsWith(closing)) content = first.slice(0, -2)
  else {
    while (next < end && !line(next).endsWith(closing)) {
      content += '\n' + line(next)
      next++
    }
    if (next === end) return false
    content += '\n' + line(next).slice(0, -2)
    next++
  }
  if (silent) return true
  const token = state.push('math_block', '', 0)
  token.block = true
  token.content = content.trim()
  token.map = [start, next]
  state.line = next
  return true
})
markdown.renderer.rules.math_block = (tokens, index) => formula(tokens[index]!.content, true) + '\n'
installWikiLinks(markdown)
installReadingMapping(markdown)
interface ReadingEnvironment {
  readingMapping?: boolean
  resources: ReadonlyMap<string, string>
  anchor?: (html: string, start: number, end: number) => string
  wiki?: (html: string, target: string) => string
  task?: (offset: number, checked: boolean) => string
}
markdown.renderer.rules.text = (tokens, index, _options, env: ReadingEnvironment) =>
  env.anchor
    ? readingTextSpans(tokens[index]!, markdown.utils.escapeHtml, env.anchor)
    : markdown.utils.escapeHtml(tokens[index]!.content)
markdown.renderer.rules.code_inline = (tokens, index, _options, env: ReadingEnvironment) =>
  '<code>' +
  (env.anchor
    ? readingTextSpans(tokens[index]!, markdown.utils.escapeHtml, env.anchor)
    : markdown.utils.escapeHtml(tokens[index]!.content)) +
  '</code>'
markdown.renderer.rules.wiki_link = (tokens, index, _options, env: ReadingEnvironment) => {
  const token = tokens[index]!
  const label = env.anchor
    ? readingTextSpans(token, markdown.utils.escapeHtml, env.anchor)
    : markdown.utils.escapeHtml(token.content)
  return env.wiki ? env.wiki(label, token.meta.target) : label
}
for (const type of ['fence', 'code_block']) {
  const render = markdown.renderer.rules[type]!
  markdown.renderer.rules[type] = (tokens, index, options, env: ReadingEnvironment, renderer) => {
    const html = render(tokens, index, options, env, renderer)
    return env.anchor
      ? readingCodeHtml(html, tokens[index]!, markdown.utils.escapeHtml, env.anchor)
      : html
  }
}
export function renderMarkdown(
  text: string,
  resources: ReadonlyMap<string, string> = new Map(),
): string {
  const scope = contentScope()
  return wrapHtml(cleanHtml(markdown.render(text, { resources }), scope, resources), scope)
}

/** Wrap top-level blocks with source offsets; ordinary card rendering stays unchanged. */
export function renderReadingMarkdown(
  text: string,
  resources: ReadonlyMap<string, string> = new Map(),
  options: { editableTasks?: boolean } = {},
): string {
  const scope = contentScope()
  const nonce = 'reading-' + crypto.randomUUID()
  const wrappers = new Map<string, string>()
  const trusted = (html: string, attributes: string, tag = 'span') => {
    const key = `${nonce}-${wrappers.size}`
    wrappers.set(key, attributes)
    return `<${tag} class="${key}">${html}</${tag}>`
  }
  const environment: ReadingEnvironment = {
    readingMapping: true,
    resources,
    anchor: (html, start, end) =>
      trusted(html, `data-reading-start="${start}" data-reading-stop="${end}"`),
    wiki: (html, target) =>
      trusted(
        html,
        `class="reading-wiki-link" data-wiki-target="${markdown.utils.escapeHtml(target)}" role="link" tabindex="0"`,
        'a',
      ),
    task: (offset, checked) =>
      trusted(
        checked ? '☑' : '☐',
        `class="reading-task-toggle" data-reading-task="${offset}" role="checkbox" aria-checked="${checked}" aria-disabled="${options.editableTasks === false}" aria-label="${markdown.utils.escapeHtml(t('切换任务完成状态'))}" tabindex="${options.editableTasks === false ? -1 : 0}"`,
      ),
  }
  const lines = [0]
  for (let index = 0; index < text.length; index++) if (text[index] === '\n') lines.push(index + 1)
  const tokens = markdown.parse(text, environment)
  attachReadingOrigins(tokens, text)
  // Task controls are renderer-owned; raw HTML never gains an actionable marker.
  const renderTokens = tokens.map((token) => {
    if (token.type === 'inline' && token.meta?.readingTask) {
      const task = token.meta.readingTask as { offset: number; checked: boolean }
      token.children!.unshift({
        type: 'reading_task',
        content: environment.task!(task.offset, task.checked),
        nesting: 0,
        level: 0,
      } as import('markdown-it/lib/token.mjs').default)
    }
    return token
  })
  markdown.renderer.rules.reading_task = (children, index) => children[index]!.content
  const blocks: string[] = []
  for (let index = 0; index < renderTokens.length;) {
    const token = renderTokens[index]!
    let end = index + 1
    if (token.nesting === 1)
      while (
        end < tokens.length &&
        !(tokens[end]!.level === token.level && tokens[end]!.nesting === -1)
      )
        end++
    if (token.nesting === 1 && end < tokens.length) end++
    const html = cleanHtml(
      markdown.renderer.render(tokens.slice(index, end), markdown.options, environment),
      scope,
      resources,
    )
    blocks.push(
      token.map
        ? `<div class="reading-block" data-reading-offset="${lines[token.map[0]] ?? 0}" data-reading-end="${lines[token.map[1]] ?? text.length}">${html}</div>`
        : html,
    )
    index = end
  }
  const safe = blocks
    .join('')
    .replace(/class="([^"]+)"/g, (attribute, key: string) =>
      wrappers.has(key) ? wrappers.get(key)! : attribute,
    )
  return wrapHtml(safe, scope)
}
