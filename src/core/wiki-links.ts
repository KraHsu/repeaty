import type { Source } from './source-data'
import type MarkdownIt from 'markdown-it'

export interface WikiLink {
  start: number
  end: number
  target: string
  label: string
}

/** A bounded Wiki reference. It never represents a browser URL. */
export function wikiAt(text: string, start: number): WikiLink | undefined {
  if (!text.startsWith('[[', start)) return
  const end = text.indexOf(']]', start + 2)
  if (end < 0 || end - start > 600) return
  const body = text.slice(start + 2, end)
  if (/[\r\n\[\]]/.test(body)) return
  const split = body.indexOf('|')
  const target = (split < 0 ? body : body.slice(0, split)).trim()
  const label = (split < 0 ? target : body.slice(split + 1)).trim()
  if (!target || target.length > 300 || !label || label.length > 200) return
  return { start, end: end + 2, target, label }
}

/** Keep code, escaped brackets and HTML markup out of the backlink index. */
export function parseWikiLinks(text: string): WikiLink[] {
  const result: WikiLink[] = []
  let index = 0,
    fence = '',
    inline = ''
  while (index < text.length) {
    if (index === 0 || text[index - 1] === '\n') {
      const lineEnd = text.indexOf('\n', index)
      const line = text.slice(index, lineEnd < 0 ? undefined : lineEnd)
      const match = /^ {0,3}(`{3,}|~{3,})/.exec(line)
      if (match && (!fence || (match[1]![0] === fence[0] && match[1]!.length >= fence.length))) {
        fence = fence ? '' : match[1]!
        index += line.length + 1
        inline = ''
        continue
      }
      if (fence) {
        index += line.length + 1
        continue
      }
    }
    if (text[index] === '\\') {
      index += 2
      continue
    }
    if (text[index] === '`') {
      const run = /^`+/.exec(text.slice(index))![0]
      if (inline === run) inline = ''
      else if (!inline && text.indexOf(run, index + run.length) >= 0) inline = run
      index += run.length
      continue
    }
    if (inline) {
      index++
      continue
    }
    if (text.startsWith('<!--', index)) {
      const end = text.indexOf('-->', index + 4)
      index = end < 0 ? text.length : end + 3
      continue
    }
    if (text[index] === '<' && /^<\/?[a-zA-Z]/.test(text.slice(index))) {
      const tag = /^<\s*(script|style|pre|code)\b[^>]*>/i.exec(text.slice(index))
      if (tag) {
        const end = text.toLowerCase().indexOf(`</${tag[1]!.toLowerCase()}>`, index + tag[0].length)
        index = end < 0 ? text.length : end + tag[1]!.length + 3
      } else {
        const end = text.indexOf('>', index + 1)
        index = end < 0 ? text.length : end + 1
      }
      continue
    }
    const link = text[index - 1] === '!' ? undefined : wikiAt(text, index)
    if (link) {
      result.push(link)
      index = link.end
    } else index++
  }
  return result
}

const fold = (text: string) => text.trim().normalize('NFKC').toLocaleLowerCase()
export function resolveWikiTarget<T extends Pick<Source, 'id' | 'title'>>(
  target: string,
  sources: readonly T[],
): T[] {
  if (target.startsWith('source:')) {
    try {
      const id = decodeURIComponent(target.slice(7))
      return sources.filter((source) => source.id === id)
    } catch {
      return []
    }
  }
  return sources.filter((source) => fold(source.title) === fold(target))
}
export function stableWikiLink(source: Pick<Source, 'id' | 'title'>) {
  const title = source.title.replace(/[\r\n|\[\]]/g, ' ').trim() || source.id
  return `[[source:${encodeURIComponent(source.id)}|${title}]]`
}

/** Renderer and DOM event ownership remain with the host's content renderer. */
export function installWikiLinks(markdown: MarkdownIt) {
  markdown.inline.ruler.before('link', 'wiki_link', (state, silent) => {
    const link = wikiAt(state.src, state.pos)
    if (!link || state.src[state.pos - 1] === '!') return false
    if (!silent) {
      const body = state.src.slice(link.start + 2, link.end - 2)
      const separator = body.indexOf('|')
      const rawLabel = separator < 0 ? body : body.slice(separator + 1)
      const labelStart =
        link.start +
        2 +
        (separator < 0 ? 0 : separator + 1) +
        rawLabel.length -
        rawLabel.trimStart().length
      const token = state.push('wiki_link', '', 0)
      token.content = link.label
      token.meta = { target: link.target, labelStart, labelEnd: labelStart + link.label.length }
    }
    state.pos = link.end
    return true
  })
}
