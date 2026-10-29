import { characterBoundary } from './source-data'

export type MarkdownEditAction = 'indent' | 'outdent' | 'continue-list' | 'task' | 'code' | 'math'
export interface MarkdownEdit {
  text: string
  start: number
  end: number
}
const list = /^([ \t]*(?:>[ \t]*)*)([-+*]|\d+[.)])([ \t]+)(?:\[([ xX])\]([ \t]+))?/
function inFence(text: string, end: number) {
  let open: { marker: string; quotes: number; indent: number } | undefined
  for (const line of text.slice(0, end).split('\n')) {
    const prefix = /^(?: {0,3}> ?)*/.exec(line)![0]
    const quoted = line.slice(prefix.length),
      quotes = (prefix.match(/>/g) ?? []).length
    if (open) {
      const closing = new RegExp(`^ {0,${open.indent}}(\x60{3,}|~{3,})\\s*$`).exec(quoted)?.[1]
      if (
        closing &&
        quotes === open.quotes &&
        closing[0] === open.marker[0] &&
        closing.length >= open.marker.length
      )
        open = undefined
    } else {
      const listPrefix = /^ {0,3}(?:[-+*]|\d+[.)])[ \t]+/.exec(quoted)?.[0] ?? ''
      const marker = /^ {0,3}(`{3,}|~{3,})/.exec(quoted.slice(listPrefix.length))?.[1]
      if (marker) open = { marker, quotes, indent: Math.min(12, listPrefix.length + 3) }
    }
  }
  return !!open
}
/** Pure text edits; callers retain native composition and text undo ownership. */
export function applyMarkdownEdit(
  text: string,
  start: number,
  end: number,
  action: MarkdownEditAction,
): MarkdownEdit | undefined {
  start = characterBoundary(text, start)
  end = characterBoundary(text, Math.max(start, end))
  const from = start === 0 ? 0 : text.lastIndexOf('\n', start - 1) + 1
  const replace = (
    a: number,
    b: number,
    value: string,
    selectionStart: number,
    selectionEnd = selectionStart,
  ) => ({
    text: text.slice(0, a) + value + text.slice(b),
    start: selectionStart,
    end: selectionEnd,
  })
  if (action === 'continue-list') {
    if (start !== end || inFence(text, from)) return undefined
    const lineEnd = text.indexOf('\n', from),
      line = text.slice(from, lineEnd < 0 ? text.length : lineEnd),
      marker = list.exec(line)
    if (!marker || start < from + marker[0].length) return undefined
    if (!line.slice(marker[0].length).trim())
      return replace(from, from + marker[0].length, marker[1]!, from + marker[1]!.length)
    const next = /^\d/.test(marker[2]!)
      ? String(Number.parseInt(marker[2]!, 10) + 1) + marker[2]!.slice(-1)
      : marker[2]!
    const inserted = '\n' + marker[1] + next + marker[3] + (marker[4] !== undefined ? '[ ] ' : '')
    return replace(start, end, inserted, start + inserted.length)
  }
  if (action === 'code' || action === 'math') {
    const selected = text.slice(start, end)
    let fenceLength = 3
    if (action === 'code')
      for (const entry of selected.matchAll(/`+/g))
        fenceLength = Math.max(fenceLength, entry[0].length + 1)
    const marker = action === 'code' ? '`'.repeat(fenceLength) : '$$'
    const prefix = (start > 0 && text[start - 1] !== '\n' ? '\n' : '') + marker + '\n'
    const suffix = '\n' + marker + (end < text.length && text[end] !== '\n' ? '\n' : '')
    return replace(
      start,
      end,
      prefix + selected + suffix,
      start + prefix.length,
      start + prefix.length + selected.length,
    )
  }
  const ending = end > start && text[end - 1] === '\n' ? end - 1 : end
  const nextLine = text.indexOf('\n', ending)
  const to = nextLine < 0 ? text.length : nextLine
  const lines = text.slice(from, to).split('\n')
  let offset = from,
    nextStart = start,
    nextEnd = end
  const changed = lines
    .map((line) => {
      let remove = 0,
        insert = ''
      if (action === 'indent') insert = '  '
      else if (action === 'outdent') remove = /^(?:\t| {1,2})/.exec(line)?.[0].length ?? 0
      else if (action === 'task') {
        const marker = list.exec(line)
        if (marker?.[4] !== undefined) {
          const check = marker[1]!.length + marker[2]!.length + marker[3]!.length + 1
          const result =
            line.slice(0, check) + (marker[4] === ' ' ? 'x' : ' ') + line.slice(check + 1)
          offset += line.length + 1
          return result
        }
        if (marker) {
          remove = marker[0].length
          insert = marker[0] + '[ ] '
        } else insert = '- [ ] '
      }
      const delta = insert.length - remove
      if (offset <= start)
        nextStart += start < offset + remove ? insert.length - (start - offset) : delta
      if (offset < end || start === end)
        nextEnd += end < offset + remove ? insert.length - (end - offset) : delta
      offset += line.length + 1
      return insert + line.slice(remove)
    })
    .join('\n')
  return replace(from, to, changed, nextStart, Math.max(nextStart, nextEnd))
}
