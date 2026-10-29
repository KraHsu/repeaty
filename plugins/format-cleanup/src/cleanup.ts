export interface CleanupRule {
  kind: 'literal' | 'regex'
  find: string
  replace: string
  flags?: string
  enabled?: boolean
}
export interface CleanupOptions {
  trimTrailing: boolean
  collapseBlankLines: boolean
  normalizeIndent: boolean
  rules: CleanupRule[]
}
/** Self-contained so the same checked engine can execute inside a host-owned Worker. */
export function cleanupText(text: string, options: CleanupOptions): string {
  const limit = 250_000
  if (
    typeof text !== 'string' ||
    text.length > limit ||
    !Array.isArray(options.rules) ||
    options.rules.length > 32
  )
    throw new Error('文档或规则超过限制。')
  type Span = { start: number; end: number }
  function escaped(value: string, index: number) {
    let slashes = 0
    while (index > 0 && value[--index] === '\\') slashes++
    return slashes % 2 === 1
  }
  function protectedSpans(value: string): Span[] {
    const spans: Span[] = []
    const add = (start: number, end: number) => spans.push({ start, end })
    const lines = [...value.matchAll(/[^\n]*(?:\n|$)/g)].filter((match) => match[0].length)
    let fence:
      { start: number; marker: string; length: number; quotes: number; indent: number } | undefined
    let frontmatter = false
    let referenceDestination = false
    const references = new Set<string>()
    const referenceKey = (label: string) => label.trim().replace(/\s+/g, ' ').toLowerCase()
    for (const [index, match] of lines.entries()) {
      const start = match.index!,
        line = match[0].replace(/\r?\n$/, '')
      if (index === 0 && line === '---') {
        frontmatter = true
        add(start, start + match[0].length)
        continue
      }
      if (frontmatter) {
        add(start, start + match[0].length)
        if (/^(---|\.\.\.)\s*$/.test(line)) frontmatter = false
        continue
      }
      const quotePrefix = /^(?: {0,3}> ?)*/.exec(line)![0]
      const quoted = line.slice(quotePrefix.length)
      const quotes = (quotePrefix.match(/>/g) ?? []).length
      const listPrefix = /^ {0,3}(?:[-+*]|\d+[.)])[ \t]+/.exec(quoted)?.[0] ?? ''
      const stripped = quoted.slice(listPrefix.length)
      const reference = /^ {0,3}\[([^\]]+)\]:[ \t]*(.*)$/.exec(stripped)
      if (reference) {
        references.add(referenceKey(reference[1]!))
        referenceDestination = !reference[2]
        add(start, start + match[0].length)
      } else if (referenceDestination) {
        add(start, start + match[0].length)
        referenceDestination = false
      }
      const opening = /^ {0,3}(`{3,}|~{3,})/.exec(stripped)
      if (fence) {
        // List markers and extra quote characters inside code are literal code,
        // never new container prefixes that can close the active fence.
        const closing = new RegExp(`^ {0,${fence.indent}}(\x60{3,}|~{3,})\\s*$`).exec(quoted)
        if (
          closing &&
          quotes === fence.quotes &&
          closing[1]![0] === fence.marker &&
          closing[1]!.length >= fence.length
        ) {
          add(fence.start, start + match[0].length)
          fence = undefined
        }
      } else if (opening) {
        fence = {
          start,
          marker: opening[1]![0]!,
          length: opening[1]!.length,
          quotes,
          indent: Math.min(12, listPrefix.length + 3),
        }
      } else if (/^(?: {4}|\t)/.test(stripped) || /^ {0,3}\[[^\]]+\]:/.test(stripped)) {
        add(start, start + match[0].length)
      }
    }
    if (fence) add(fence.start, value.length)
    // Code spans may contain newlines and arbitrary runs of backticks.
    for (let index = 0; index < value.length; index++) {
      if (value[index] !== '`' || escaped(value, index)) continue
      let length = 1
      while (value[index + length] === '`') length++
      const run = '`'.repeat(length)
      let close = value.indexOf(run, index + length)
      while (close >= 0 && (value[close - 1] === '`' || value[close + length] === '`'))
        close = value.indexOf(run, close + length)
      if (close >= 0) {
        add(index, close + length)
        index = close + length - 1
      } else index += length - 1
    }
    // Protect both absolute URLs and relative Markdown destinations, including nested parentheses.
    for (const match of value.matchAll(
      /(?:https?:\/\/|ftp:\/\/|mailto:|data:|file:|www\.)[^\s<>]+|<(?:[^>"']|"[^"]*"|'[^']*')*>/gi,
    ))
      add(match.index!, match.index! + match[0].length)
    for (const match of value.matchAll(/<(pre|code|script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi))
      add(match.index!, match.index! + match[0].length)
    for (const match of value.matchAll(/\[\[([^\]\r\n]+)\]\]/g)) {
      if (escaped(value, match.index!)) continue
      const split = match[1]!.indexOf('|')
      add(match.index!, match.index! + (split < 0 ? match[0].length : 3 + split))
    }
    for (const match of value.matchAll(/!?\[([^\]\n]+)\](?:\[([^\]\n]*)\])?/g)) {
      if (escaped(value, match.index!)) continue
      if (match[2] !== undefined) {
        // With an empty identifier, changing the label also changes its destination.
        const start = match.index! + (match[2] ? match[0].lastIndexOf('[') : 0)
        add(start, match.index! + match[0].length)
      } else if (
        value[match.index! + match[0].length] !== '(' &&
        references.has(referenceKey(match[1]!))
      )
        add(match.index!, match.index! + match[0].length)
    }
    for (let index = 0; index < value.length - 1; index++) {
      if (value.slice(index, index + 2) !== '](' || escaped(value, index)) continue
      let depth = 1,
        end = index + 2
      for (; end < value.length && depth; end++) {
        if (value[end] === '\\') {
          end++
          continue
        }
        if (value[end] === '(') depth++
        if (value[end] === ')') depth--
      }
      add(index, end)
      index = end - 1
    }
    spans.sort((a, b) => a.start - b.start || a.end - b.end)
    const merged: Span[] = []
    for (const span of spans) {
      const previous = merged.at(-1)
      if (previous && span.start <= previous.end) previous.end = Math.max(previous.end, span.end)
      else merged.push({ ...span })
    }
    return merged
  }
  function outside(value: string, transform: (part: string, start: number) => string) {
    let result = '',
      cursor = 0
    for (const span of protectedSpans(value)) {
      result +=
        transform(value.slice(cursor, span.start), cursor) + value.slice(span.start, span.end)
      if (result.length > limit) throw new Error('清理结果超过 250000 字符。')
      cursor = span.end
    }
    result += transform(value.slice(cursor), cursor)
    if (result.length > limit) throw new Error('清理结果超过 250000 字符。')
    return result
  }
  function append(current: string, addition: string) {
    if (current.length + addition.length > limit) throw new Error('清理结果超过 250000 字符。')
    return current + addition
  }
  function substitution(match: RegExpMatchArray, source: string, replacement: string) {
    let result = '',
      cursor = 0
    for (const token of replacement.matchAll(/\$([$&`']|\d{1,2}|<[^>]+>)/g)) {
      result = append(result, replacement.slice(cursor, token.index))
      const key = token[1]!,
        index = match.index!
      let value = token[0]
      if (key === '$') value = '$'
      else if (key === '&') value = match[0]
      else if (key === '`') value = source.slice(0, index)
      else if (key === "'") value = source.slice(index + match[0].length)
      else if (key[0] === '<' && match.groups) value = match.groups[key.slice(1, -1)] ?? ''
      else if (/^\d/.test(key)) {
        const capture = Number(key)
        if (capture > 0 && capture < match.length) value = match[capture] ?? ''
        else if (key.length === 2 && Number(key[0]) > 0 && Number(key[0]) < match.length)
          value = (match[Number(key[0])] ?? '') + key[1]
      }
      result = append(result, value)
      cursor = token.index! + token[0].length
    }
    return append(result, replacement.slice(cursor))
  }
  function replaceBounded(
    part: string,
    rule: CleanupRule,
    pattern?: RegExp,
    protectedRanges: Span[] = [],
  ) {
    let result = '',
      cursor = 0
    if (pattern) {
      let protectedIndex = 0
      for (const match of part.matchAll(pattern)) {
        while (
          protectedRanges[protectedIndex] &&
          protectedRanges[protectedIndex]!.end <= match.index!
        )
          protectedIndex++
        const protectedRange = protectedRanges[protectedIndex]
        if (
          protectedRange &&
          match.index! < protectedRange.end &&
          (match[0].length
            ? match.index! + match[0].length > protectedRange.start
            : match.index! >= protectedRange.start)
        )
          continue
        result = append(result, part.slice(cursor, match.index))
        result = append(result, substitution(match, part, rule.replace))
        cursor = match.index! + match[0].length
      }
    } else {
      let index = part.indexOf(rule.find)
      while (index >= 0) {
        result = append(result, part.slice(cursor, index))
        result = append(result, rule.replace)
        cursor = index + rule.find.length
        index = part.indexOf(rule.find, cursor)
      }
    }
    return append(result, part.slice(cursor))
  }
  let result = outside(text, (part, start) => {
    if (options.trimTrailing)
      part = part.replace(/[\t ]+(?=\r?$)/gm, (space: string, offset: number) => {
        const end = start + offset + space.length
        // A protected code/URL span is not an end of line.
        if (end < text.length && !/[\r\n]/.test(text[end]!)) return space
        return space.endsWith('  ') ? '  ' : ''
      })
    if (options.collapseBlankLines) part = part.replace(/(\r?\n)(?:[ \t]*\r?\n){2,}/g, '$1$1')
    if (options.normalizeIndent)
      part = part.replace(
        /(^|\n)([ \t]+)/g,
        (all, newline: string, space: string, offset: number) => {
          if (offset === 0 && start > 0 && text[start - 1] !== '\n') return all
          return newline + space.replace(/\t/g, '    ')
        },
      )
    return part
  })
  for (const rule of options.rules) {
    if (rule.enabled === false) continue
    if (
      !['literal', 'regex'].includes(rule.kind) ||
      typeof rule.find !== 'string' ||
      !rule.find ||
      rule.find.length > 1000 ||
      typeof rule.replace !== 'string' ||
      rule.replace.length > 1000
    )
      throw new Error('替换规则无效；查找内容不能为空，每项最多 1000 字符。')
    if (rule.kind === 'literal') result = outside(result, (part) => replaceBounded(part, rule))
    else {
      if (typeof (rule.flags ?? '') !== 'string' || /[^gimu]/.test(rule.flags ?? ''))
        throw new Error('正则标志仅支持 g、i、m、u。')
      const pattern = new RegExp(rule.find, [...new Set('gu' + (rule.flags ?? ''))].join(''))
      result = replaceBounded(result, rule, pattern, protectedSpans(result))
    }
  }
  if (!result.trim()) throw new Error('清理结果为空，请调整规则。')
  return result
}
