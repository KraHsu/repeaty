import type MarkdownIt from 'markdown-it'
import type Token from 'markdown-it/lib/token.mjs'
import type StateInline from 'markdown-it/lib/rules_inline/state_inline.mjs'
import { parseFragment, serialize, type DefaultTreeAdapterTypes } from 'parse5'

type Point = readonly [number, number]
interface Tracked {
  text: string
  points: Point[]
}
interface MappingEnvironment {
  readingMapping?: boolean
}
const meta = (token: Token) => (token.meta ??= {}) as { readingPoints?: Point[] }

function pointsFor(raw: string, output: string, start: number): Point[] {
  if (raw === output || raw.replaceAll('\n', ' ') === output)
    return Array.from({ length: output.length }, (_, i) => [start + i, start + i + 1])
  // An escape/entity is one atomic source unit. A partial surrogate selection is
  // rejected by the DOM mapper; decoded text never points at a guessed occurrence.
  if (/^\\[^\n]$/.test(raw) || /^&(?:#x[\da-f]+|#\d+|\w+);$/i.test(raw))
    return Array.from({ length: output.length }, () => [start, start + raw.length])
  return []
}

/** Instrument the parser's actual consumed ranges, before emphasis rewrites tokens. */
export function installReadingMapping(md: MarkdownIt) {
  const original = md.inline.tokenize
  const tracked = new WeakMap<StateInline, Tracked>()
  md.inline.tokenize = function (state) {
    if (!(state.env as MappingEnvironment).readingMapping) return original.call(this, state)
    let pending = tracked.get(state)
    if (!pending) {
      pending = { text: '', points: [] }
      tracked.set(state, pending)
      const push = state.pushPending
      state.pushPending = function () {
        const current = tracked.get(state)!
        // The newline rule trims pending trailing spaces before flushing.
        const points = current.text.startsWith(state.pending)
          ? current.points.slice(0, state.pending.length)
          : []
        const token = push.call(state)
        if (points.length === token.content.length) meta(token).readingPoints = points
        current.text = ''
        current.points = []
        return token
      }
    }
    const rules = this.ruler.getRules('')
    const end = state.posMax
    while (state.pos < end) {
      const start = state.pos,
        before = state.tokens.length
      let accepted = false
      if (state.level < (state.md.options as { maxNesting: number }).maxNesting)
        for (const rule of rules) {
          if (rule(state, false)) {
            accepted = true
            break
          }
        }
      if (!accepted) state.pending += state.src[state.pos++]
      if (state.pos <= start) throw new Error('Markdown inline rule did not consume input')
      const raw = state.src.slice(start, state.pos)
      let cursor = start
      for (const token of state.tokens.slice(before)) {
        if (meta(token).readingPoints) continue // Recursive link labels are already mapped.
        if (
          token.type === 'text' &&
          raw ===
            state.tokens
              .slice(before)
              .map((t) => t.content)
              .join('')
        ) {
          meta(token).readingPoints = pointsFor(token.content, token.content, cursor)
          cursor += token.content.length
        } else if (token.type === 'text_special') {
          meta(token).readingPoints = pointsFor(raw, token.content, start)
        } else if (token.type === 'code_inline') {
          let codeStart = start + token.markup.length
          let code = raw.slice(token.markup.length, -token.markup.length)
          if (/^ (.+) $/s.test(code.replaceAll('\n', ' '))) {
            codeStart++
            code = code.slice(1, -1)
          }
          meta(token).readingPoints = pointsFor(code, token.content, codeStart)
        } else if (token.type === 'wiki_link') {
          const { labelStart, labelEnd } = token.meta as { labelStart: number; labelEnd: number }
          meta(token).readingPoints = pointsFor(
            state.src.slice(labelStart, labelEnd),
            token.content,
            labelStart,
          )
        }
      }
      if (state.pending.startsWith(pending.text)) {
        const added = state.pending.slice(pending.text.length)
        const additions = pointsFor(raw, added, start)
        pending.points = additions.length === added.length ? [...pending.points, ...additions] : []
      } else if (pending.text.startsWith(state.pending))
        pending.points = pending.points.slice(0, state.pending.length)
      else pending.points = []
      pending.text = state.pending
    }
    if (state.pending) state.pushPending()
  }
  // Preserve adjacent mapped spans. This is the same level recalculation as
  // markdown-it's MIT-licensed fragments_join rule, without merging provenance.
  const join = md.inline.ruler2.getRules('').at(-1)!
  md.inline.ruler2.at('fragments_join', (state) => {
    if (!(state.env as MappingEnvironment).readingMapping) return join(state)
    let level = 0
    for (const token of state.tokens) {
      if (token.nesting < 0) level--
      token.level = level
      if (token.nesting > 0) level++
    }
    return true
  })
  const textJoin = md.core.ruler.getRules('').at(-1)!
  md.core.ruler.at('text_join', (state) => {
    if (!(state.env as MappingEnvironment).readingMapping) return textJoin(state)
    for (const block of state.tokens)
      for (const child of block.children ?? [])
        if (child.type === 'text_special') child.type = 'text'
  })
}

function sourceLines(text: string) {
  const lines: { text: string; start: number; end: number }[] = []
  const pattern = /([^\r\n]*)(\r\n|\r|\n|$)/g
  for (const match of text.matchAll(pattern)) {
    if (!match[0] && match.index === text.length) break
    lines.push({ text: match[1]!, start: match.index, end: match.index + match[0].length })
  }
  return lines
}
function structuralPrefix(prefix: string) {
  // Container markers removed by the block parser. Never skip prose to find a
  // later identical label; ambiguous matches are deliberately left unmapped.
  let rest = prefix.replace(/^\s*/, '')
  for (let depth = 0; depth < 32 && rest; depth++) {
    const next = rest.replace(/^(?:>\s*|(?:[-+*]|\d+[.)])\s+)/, '')
    if (next === rest) break
    rest = next
  }
  return /^(?:#{1,6}\s+)?$/.test(rest)
}
function linePoints(line: { text: string; start: number }, content: string): Point[] {
  const found: number[] = []
  if (!content) return []
  for (let from = 0; from <= line.text.length - content.length;) {
    const at = line.text.indexOf(content, from)
    if (at < 0) break
    if (
      structuralPrefix(line.text.slice(0, at)) &&
      /^(?:\s+#+)?\s*$/.test(line.text.slice(at + content.length))
    )
      found.push(at)
    from = at + 1
  }
  return found.length === 1
    ? Array.from({ length: content.length }, (_, i) => [
        line.start + found[0]! + i,
        line.start + found[0]! + i + 1,
      ])
    : []
}
function tableCells(line: { text: string; start: number }): { text: string; points: Point[] }[] {
  const result: { text: string; points: Point[] }[] = []
  let cell = { text: '', points: [] as Point[] }
  // The GFM table parser removes one backslash immediately preceding a pipe.
  for (let i = 0; i < line.text.length; i++) {
    const char = line.text[i]!
    if (char === '|' && line.text[i - 1] !== '\\') {
      result.push(cell)
      cell = { text: '', points: [] }
    } else {
      if (char === '|' && line.text[i - 1] === '\\') {
        cell.text = cell.text.slice(0, -1)
        cell.points.pop()
      }
      cell.text += char
      cell.points.push([line.start + i, line.start + i + 1])
    }
  }
  result.push(cell)
  if (!result[0]!.text.trim()) result.shift()
  if (result.length && !result.at(-1)!.text.trim()) result.pop()
  return result.map(({ text, points }) => {
    const start = text.length - text.trimStart().length
    return { text: text.trim(), points: points.slice(start, text.trimEnd().length) }
  })
}

export function attachReadingOrigins(tokens: Token[], text: string) {
  const lines = sourceLines(text)
  let cells: ReturnType<typeof tableCells> | undefined,
    cellIndex = 0,
    firstListParagraph = false
  for (const token of tokens) {
    if (token.type === 'list_item_open') firstListParagraph = true
    else if (token.type === 'list_item_close') firstListParagraph = false
    if (token.type === 'tr_open' && token.map) {
      cells = tableCells(lines[token.map[0]]!)
      cellIndex = 0
    } else if (token.type === 'tr_close') cells = undefined
    if (['fence', 'code_block'].includes(token.type) && token.map) {
      const content = token.content.split('\n')
      const positions: Point[] = []
      for (let index = 0; index < content.length; index++) {
        const line = lines[token.map[0] + (token.type === 'fence' ? 1 : 0) + index]
        if (!line || (index === content.length - 1 && !content[index])) break
        const mapped = linePoints(line, content[index]!)
        if (mapped.length !== content[index]!.length) {
          positions.length = 0
          break
        }
        positions.push(...mapped)
        if (index < content.length - 1)
          positions.push(
            line.end > line.start + line.text.length
              ? [line.start + line.text.length, line.end]
              : [-1, -1],
          )
      }
      if (positions.length === token.content.length) meta(token).readingPoints = positions
    }
    if (token.type !== 'inline') continue
    let positions: Point[] = []
    if (token.map) {
      const contentLines = token.content.split('\n')
      for (const [index, content] of contentLines.entries()) {
        const line = lines[token.map[0] + index]
        if (!line) break
        const mapped = linePoints(line, content)
        if (mapped.length !== content.length) {
          positions = []
          break
        }
        positions.push(...mapped)
        if (index < contentLines.length - 1)
          positions.push([line.start + line.text.length, line.end])
      }
    } else if (cells) {
      const cell = cells[cellIndex++]
      if (cell?.text === token.content) positions = cell.points
    }
    if (firstListParagraph && /^\[[ xX]\]\s/.test(token.content) && positions[1]) {
      let remaining = 3
      for (const child of token.children ?? []) {
        if (!remaining) break
        if (child.type !== 'text') break
        const count = Math.min(remaining, child.content.length)
        child.content = child.content.slice(count)
        const points = meta(child).readingPoints
        if (points) meta(child).readingPoints = points.slice(count)
        remaining -= count
      }
      if (!remaining)
        token.meta = {
          ...token.meta,
          readingTask: { offset: positions[1][0], checked: token.content[1] !== ' ' },
        }
    }
    firstListParagraph = false
    for (const child of token.children ?? []) {
      const local = meta(child).readingPoints
      if (!local) continue
      meta(child).readingPoints = local.map(([start, end]) => {
        const first = positions[start],
          last = positions[end - 1]
        return first && last ? [first[0], last[1]] : [-1, -1]
      })
    }
  }
}

export function readingTextSpans(
  token: Token,
  escape: (text: string) => string,
  wrap: (html: string, start: number, end: number) => string,
) {
  const points = meta(token).readingPoints
  if (!points || points.length !== token.content.length) return escape(token.content)
  let result = ''
  for (let from = 0; from < points.length;) {
    let to = from + 1
    const first = points[from]!
    if (first[0] < 0 || first[1] <= first[0]) {
      result += escape(token.content[from]!)
      from++
      continue
    }
    const atomic = first[1] - first[0] !== 1
    while (to < points.length) {
      const current = points[to]!,
        prior = points[to - 1]!
      if (
        atomic
          ? current[0] !== first[0] || current[1] !== first[1]
          : current[0] !== prior[1] || current[1] - current[0] !== 1
      )
        break
      to++
    }
    result += wrap(escape(token.content.slice(from, to)), first[0], points[to - 1]![1])
    from = to
  }
  return result
}

/** Keep the syntax highlighter's markup while mapping each actual code text node. */
export function readingCodeHtml(
  html: string,
  token: Token,
  escape: (text: string) => string,
  wrap: (html: string, start: number, end: number) => string,
) {
  const points = meta(token).readingPoints
  if (!points?.length) return html
  const fragment = parseFragment(html)
  const texts: DefaultTreeAdapterTypes.TextNode[] = []
  function collect(node: DefaultTreeAdapterTypes.Node, code = false) {
    if ('tagName' in node && node.tagName === 'code') code = true
    if (code && node.nodeName === '#text') texts.push(node as DefaultTreeAdapterTypes.TextNode)
    else if ('childNodes' in node) for (const child of node.childNodes) collect(child, code)
  }
  collect(fragment)
  if (texts.map((node) => node.value).join('') !== token.content) return html
  let cursor = 0
  for (const node of texts) {
    const mapped = readingTextSpans(
      {
        ...token,
        content: node.value,
        meta: {
          readingPoints: points.slice(cursor, cursor + node.value.length),
        },
      } as Token,
      escape,
      wrap,
    )
    cursor += node.value.length
    const children = parseFragment(mapped).childNodes
    const parent = node.parentNode!
    for (const child of children) child.parentNode = parent
    parent.childNodes.splice(parent.childNodes.indexOf(node), 1, ...children)
  }
  return serialize(fragment)
}
