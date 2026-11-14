export interface SearchCompletion {
  token: string
  description: string
  query: string
  caret: number
}

export interface SearchVocabulary {
  tags: readonly string[]
  decks: readonly string[]
}

const conditions = [
  ['is:due', '已到期'],
  ['is:new', '新卡片'],
  ['is:learning', '学习中'],
  ['is:review', '复习中'],
  ['is:suspended', '已暂停'],
  ['is:buried', '今日暂缓'],
  ['is:leech', '顽固卡'],
  ['type:basic', '正反面'],
  ['type:reversed', '双向卡'],
  ['type:cloze', '挖空卡'],
  ['type:plugin', '插件题目'],
  ['type:leetcode', 'LeetCode 题目'],
  ['due:<=0', '今天及之前到期'],
  ['due:<=7', '七天内到期（含逾期）'],
  ['due:<0', '已逾期'],
  ['lapses:>=3', '至少遗忘三次'],
  ['lapses:0', '尚未遗忘'],
  ['lapses:>=1', '至少遗忘一次'],
] as const

/** Match search.ts quoting rules, but tolerate a condition still being typed. */
function tokenRange(query: string, caret: number, selectionEnd: number) {
  let start = 0
  let quoted = false
  for (let index = 0; index <= query.length; index++) {
    const character = query[index]
    if (character === '\\' && ['"', '\\'].includes(query[index + 1] ?? '')) {
      index++
      continue
    }
    if (character === '"') quoted = !quoted
    if (index === query.length || (!quoted && /\s/.test(character!))) {
      if (caret >= start && caret <= index && selectionEnd <= index) return { start, end: index }
      start = index + 1
    }
  }
}

function decode(value: string) {
  return value.replace(/\\(["\\])|"/g, (_, escaped: string | undefined) => escaped ?? '')
}

function quote(value: string) {
  const escaped = value.replace(/["\\]/g, '\\$&')
  return /[\s"\\]/.test(value) ? `"${escaped}"` : escaped
}

export function searchCompletions(
  query: string,
  caret: number,
  selectionEnd: number,
  vocabulary: SearchVocabulary,
): SearchCompletion[] {
  if (query.length > 1000 || caret < 0 || selectionEnd < caret) return []
  const range = tokenRange(query, caret, selectionEnd)
  if (!range) return []
  const raw = query.slice(range.start, caret)
  const negative = raw.startsWith('-')
  const fragment = decode(negative ? raw.slice(1) : raw).toLocaleLowerCase()
  // A quoted phrase without a field is free text, not a partially entered operator.
  if (raw.startsWith('"') || raw.startsWith('-"')) return []
  const colon = fragment.indexOf(':')
  const key = fragment.slice(0, colon)
  const value = fragment.slice(colon + 1)
  function* choices(): Generator<{ token: string; description: string; value?: string }> {
    // Keep first-focus suggestions short and useful, including actual library values.
    for (const [token, description] of fragment ? conditions : conditions.slice(0, 2))
      yield { token, description }
    if (colon < 0 || key === 'tag')
      for (const tag of fragment ? vocabulary.tags : vocabulary.tags.slice(0, 3))
        yield { token: `tag:${quote(tag)}`, description: '标签', value: tag }
    if (colon < 0 || key === 'deck')
      for (const deck of fragment ? vocabulary.decks : vocabulary.decks.slice(0, 2))
        yield { token: `deck:${quote(deck)}`, description: '卡组', value: deck }
    if (!fragment)
      for (const [token, description] of conditions.slice(7)) yield { token, description }
  }
  const seen = new Set<string>()
  const result: SearchCompletion[] = []
  for (const choice of choices()) {
    const lower = choice.token.toLocaleLowerCase()
    const matches =
      colon >= 0
        ? lower.startsWith(`${key}:`) &&
          (choice.value?.toLocaleLowerCase() ?? lower.slice(colon + 1)).startsWith(value)
        : lower.startsWith(fragment) || choice.value?.toLocaleLowerCase().startsWith(fragment)
    if (!matches || seen.has(lower)) continue
    seen.add(lower)
    const token = `${negative ? '-' : ''}${choice.token}`
    // A completed condition needs no replacement; typing a space offers the next one.
    if (token === query.slice(range.start, range.end)) continue
    const suffix = query.slice(range.end)
    const hasSeparator = /^\s/.test(suffix)
    const insertion = token + (hasSeparator ? '' : ' ')
    const completed = query.slice(0, range.start) + insertion + suffix
    if (completed.length > 1000) continue
    result.push({
      token,
      description: choice.description,
      query: completed,
      caret: range.start + insertion.length + (hasSeparator ? 1 : 0),
    })
    if (result.length === 10) break
  }
  return result
}
