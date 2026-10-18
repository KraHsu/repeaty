import { msg, LocalizedError } from '../i18n'
import {
  cardViews,
  filterStates,
  savedSearchSchema,
  type CardView,
  type Library,
  type Deck,
  type SearchFilter,
} from './model'
import { available, isBuried } from './scheduler'

export function cardStatus(card: CardView, now: Date): SearchFilter['state'] {
  if (card.suspended) return '已暂停'
  if (isBuried(card, now)) return '今日暂缓'
  if (card.schedule.state === 0) return '新卡片'
  if (new Date(card.schedule.due) <= now) return '待复习'
  return card.schedule.state === 2 ? '复习中' : '学习中'
}
// AND between terms, quoted phrases, and a leading minus for negation.
function terms(query: string): string[] {
  if (query.length > 1000) throw new LocalizedError(msg('搜索条件最多 1000 字。'))
  const result: string[] = []
  let word = '',
    quoted = false
  for (let i = 0; i < query.length; i++) {
    const ch = query[i]!
    if (ch === '\\' && ['"', '\\'].includes(query[i + 1] ?? '')) word += query[++i]
    else if (ch === '"') quoted = !quoted
    else if (/\s/.test(ch) && !quoted) {
      if (word) result.push(word)
      word = ''
    } else word += ch
  }
  if (quoted) throw new LocalizedError(msg('搜索中的双引号未闭合。'))
  if (word) result.push(word)
  return result
}
function numericCondition(expression: string, key: string): (n: number) => boolean {
  const match = expression.match(/^(<=|>=|<|>|=)?(-?\d+)$/)
  if (!match)
    throw new LocalizedError(msg('{p0} 应为数字条件，例如 {p1}:>=3。', { p0: key, p1: key }))
  const value = Number(match[2])
  if (!Number.isSafeInteger(value) || Math.abs(value) > 100000)
    throw new LocalizedError(msg('{p0} 数值超出范围。', { p0: key }))
  return (n) =>
    ({ '<': n < value, '>': n > value, '<=': n <= value, '>=': n >= value, '=': n === value })[
      match[1] ?? '='
    ]!
}
function calendarDay(date: Date) {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000
}
export function compileSearch(deckList: Deck[], filter: SearchFilter, now = new Date()) {
  const decks = new Map(deckList.map((deck) => [deck.id, deck.name.toLocaleLowerCase()]))
  const predicates = terms(filter.query).map((raw) => {
    const negate = raw.startsWith('-')
    const term = (negate ? raw.slice(1) : raw).toLocaleLowerCase()
    if (!term) throw new LocalizedError(msg('减号后需要搜索条件。'))
    const colon = term.indexOf(':')
    const key = term.slice(0, colon),
      value = term.slice(colon + 1)
    let test: (card: CardView) => boolean
    if (colon < 0 || !['tag', 'deck', 'is', 'type', 'due', 'lapses'].includes(key)) {
      test = (card) =>
        [card.front, card.back, ...card.tags].some((text) =>
          text.toLocaleLowerCase().includes(term),
        )
    } else if (!value) throw new LocalizedError(msg('{p0} 后需要填写条件。', { p0: key }))
    else if (key === 'tag')
      test = (card) => card.tags.some((tag) => tag.toLocaleLowerCase() === value)
    else if (key === 'deck') test = (card) => decks.get(card.deckId) === value
    else if (key === 'type') {
      if (!['basic', 'reversed', 'cloze', 'plugin', 'leetcode'].includes(value))
        throw new LocalizedError(msg('type 支持 basic、reversed、cloze、plugin、leetcode。'))
      test = (card) =>
        card.type === value || (value === 'leetcode' && card.plugin?.id === 'leetcode')
    } else if (key === 'is') {
      const states: Record<string, (card: CardView) => boolean> = {
        new: (card) => card.schedule.state === 0,
        due: (card) => new Date(card.schedule.due) <= now,
        review: (card) => card.schedule.state === 2,
        learning: (card) => [1, 3].includes(card.schedule.state),
        suspended: (card) => card.suspended,
        buried: (card) => isBuried(card, now),
        leech: (card) => card.leech,
      }
      if (!states[value])
        throw new LocalizedError(
          msg('is 支持 new、due、review、learning、suspended、buried、leech。'),
        )
      test = states[value]!
    } else {
      const compare = numericCondition(value, key)
      test =
        key === 'lapses'
          ? (card) => compare(card.schedule.lapses)
          : (card) => compare(calendarDay(new Date(card.schedule.due)) - calendarDay(now))
    }
    return (card: CardView) => (negate ? !test(card) : test(card))
  })
  if (!filterStates.includes(filter.state)) throw new LocalizedError(msg('筛选状态不正确。'))
  return (card: CardView) =>
    (!filter.deckId || card.deckId === filter.deckId) &&
    (filter.state === 'all' ||
      (filter.state === '顽固卡' ? card.leech : cardStatus(card, now) === filter.state)) &&
    predicates.every((test) => test(card))
}
export function searchCards(library: Library, filter: SearchFilter, now = new Date()): CardView[] {
  return cardViews(library).filter(compileSearch(library.decks, filter, now))
}
export function saveSearch(
  library: Library,
  filter: SearchFilter,
  name: string,
  id: string = crypto.randomUUID(),
): Library {
  searchCards(library, filter)
  if (filter.deckId && !library.decks.some((deck) => deck.id === filter.deckId))
    throw new LocalizedError(msg('筛选卡组已不存在。'))
  const entry = savedSearchSchema.parse({ ...filter, name, id })
  const exists = library.savedSearches.some((search) => search.id === id)
  if (!exists && library.savedSearches.length >= 100)
    throw new LocalizedError(msg('最多保存 100 个常用筛选。'))
  return {
    ...library,
    savedSearches: exists
      ? library.savedSearches.map((search) => (search.id === id ? entry : search))
      : [...library.savedSearches, entry],
  }
}
export function studyCards(
  library: Library,
  ids: string[],
  completed: string[],
  now = new Date(),
): CardView[] {
  const views = new Map(cardViews(library).map((card) => [card.id, card]))
  const done = new Set(completed)
  return [...new Set(ids)].flatMap((id) => {
    const card = views.get(id)
    return card && !done.has(id) && available(card, now) ? [card] : []
  })
}
