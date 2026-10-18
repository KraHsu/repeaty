import { t } from '../i18n'
import MarkdownIt from 'markdown-it'
import katex from 'katex'

const markdown = new MarkdownIt({ html: false, breaks: true, linkify: false })
// Attachments are stored locally; Markdown images never trigger remote requests.
markdown.renderer.rules.image = (tokens, index) =>
  `<span class="media-placeholder">${markdown.utils.escapeHtml(t('[图片：{name} · 请使用附件]', { name: tokens[index]!.content }))}</span>`
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
  if (state.src[state.pos] !== '$') return false
  const display = state.src.startsWith('$$', state.pos)
  const delimiter = display ? '$$' : '$'
  const start = state.pos + delimiter.length
  if (!display && /\s/.test(state.src[start] ?? ' ')) return false
  let end = start
  while ((end = state.src.indexOf(delimiter, end)) !== -1) {
    let slashes = 0
    for (let i = end - 1; i >= start && state.src[i] === '\\'; i--) slashes++
    if (slashes % 2 === 0) break
    end += delimiter.length
  }
  if (
    end < 0 ||
    end === start ||
    (!display && (/\s/.test(state.src[end - 1]!) || state.src.slice(start, end).includes('\n')))
  )
    return false
  if (!silent) {
    const token = state.push('math', '', 0)
    token.content = state.src.slice(start, end)
    token.meta = { display }
  }
  state.pos = end + delimiter.length
  return true
})
markdown.renderer.rules.math = (tokens, index) =>
  formula(tokens[index]!.content, tokens[index]!.meta.display)
markdown.block.ruler.before('fence', 'math_block', (state, start, end, silent) => {
  const line = (n: number) =>
    state.src.slice(state.bMarks[n]! + state.tShift[n]!, state.eMarks[n]!).trim()
  if (state.sCount[start]! - state.blkIndent >= 4 || !line(start).startsWith('$$')) return false
  const first = line(start).slice(2)
  let next = start + 1,
    content = first
  if (first.endsWith('$$')) content = first.slice(0, -2)
  else {
    while (next < end && !line(next).endsWith('$$')) {
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
export function renderMarkdown(text: string): string {
  return markdown.render(text)
}
