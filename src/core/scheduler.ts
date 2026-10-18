import { fsrs, State } from 'ts-fsrs'
import {
  cardViews,
  hydrateSchedule,
  localDay,
  serializeSchedule,
  type Card,
  type CardView,
  type Grade,
  type Deck,
  type Library,
} from './model'

function scheduler(retention = 0.9) {
  return fsrs({ request_retention: retention, enable_fuzz: false })
}
export const dayKey = localDay
export function isBuried(card: Card, now = new Date()): boolean {
  const day = localDay(now)
  return card.buriedOn === day || card.autoBurial?.day === day
}
export function available(card: Card, now = new Date()): boolean {
  return !card.suspended && !isBuried(card, now)
}
export function dailyUsage(library: Library, now = new Date()) {
  const deckByCard = new Map(cardViews(library).map((card) => [card.id, card.deckId]))
  const usage = new Map(
    library.decks.map((deck) => [deck.id, { new: new Set<string>(), review: new Set<string>() }]),
  )
  for (const review of library.reviews) {
    if (review.studyDay !== localDay(now)) continue
    const deck = usage.get(deckByCard.get(review.cardId) ?? '')
    if (deck && (review.kind === 'new' || review.kind === 'review'))
      deck[review.kind].add(review.cardId)
  }
  return usage
}
export function dueCards(library: Library, now = new Date(), deckId?: string): CardView[] {
  const usage = dailyUsage(library, now)
  const budgets = new Map(
    library.decks.map((deck) => [
      deck.id,
      {
        new: Math.max(0, deck.newLimit - (usage.get(deck.id)?.new.size ?? 0)),
        review: Math.max(0, deck.reviewLimit - (usage.get(deck.id)?.review.size ?? 0)),
      },
    ]),
  )
  return cardViews(library)
    .filter(
      (card) =>
        (!deckId || card.deckId === deckId) &&
        available(card, now) &&
        new Date(card.schedule.due) <= now,
    )
    .sort((a, b) => {
      const priority = (card: Card) =>
        card.schedule.state === State.New ? 2 : card.schedule.state === State.Review ? 1 : 0
      return (
        priority(a) - priority(b) ||
        a.schedule.due.localeCompare(b.schedule.due) ||
        a.createdAt.localeCompare(b.createdAt) ||
        a.id.localeCompare(b.id)
      )
    })
    .filter((card) => {
      const kind =
        card.schedule.state === State.New
          ? 'new'
          : card.schedule.state === State.Review
            ? 'review'
            : null
      if (!kind || usage.get(card.deckId)?.[kind].has(card.id)) return true
      const budget = budgets.get(card.deckId)!
      if (budget[kind] <= 0) return false
      budget[kind]--
      return true
    })
}
export function blockedByLimit(library: Library, now = new Date(), deckId?: string): number {
  const eligible = cardViews(library).filter(
    (card) =>
      (!deckId || card.deckId === deckId) &&
      available(card, now) &&
      new Date(card.schedule.due) <= now,
  )
  return eligible.length - dueCards(library, now, deckId).length
}
export function previewReview(card: Card, now = new Date(), deck?: Pick<Deck, 'desiredRetention'>) {
  return scheduler(deck?.desiredRetention).repeat(hydrateSchedule(card.schedule), now)
}
export function reviewCard(
  library: Library,
  id: string,
  rating: Grade,
  now = new Date(),
  source: 'normal' | 'filtered' = 'normal',
): Library {
  const card = library.cards.find((entry) => entry.id === id)
  if (!card) throw new Error('卡片已不存在。')
  if (
    !available(card, now) ||
    (source === 'normal' && !dueCards(library, now).some((entry) => entry.id === id))
  )
    throw new Error('这张卡片尚未到期、已暂停或已达到今日额度。')
  if (card.schedule.last_review && new Date(card.schedule.last_review) > now)
    throw new Error('当前时间早于上次复习，请检查本机时间。')
  const deckId = library.notes.find((note) => note.id === card.noteId)!.deckId
  const deck = library.decks.find((entry) => entry.id === deckId)!
  const result = scheduler(deck.desiredRetention).next(hydrateSchedule(card.schedule), now, rating)
  const reviewId = crypto.randomUUID()
  const siblings = deck.burySiblings
    ? library.cards.filter(
        (entry) => entry.noteId === card.noteId && entry.id !== id && available(entry, now),
      )
    : []
  const siblingIds = new Set(siblings.map((entry) => entry.id))
  const markedLeech =
    !card.leech &&
    deck.leechThreshold > 0 &&
    rating === 1 &&
    result.card.lapses > card.schedule.lapses &&
    result.card.lapses >= deck.leechThreshold
  return {
    ...library,
    cards: library.cards.map((entry) =>
      entry.id === id
        ? {
            ...entry,
            schedule: serializeSchedule(result.card),
            updatedAt: now.toISOString(),
            leech: entry.leech || markedLeech,
          }
        : siblingIds.has(entry.id)
          ? { ...entry, autoBurial: { day: localDay(now), reviewId } }
          : entry,
    ),
    reviews: [
      ...library.reviews,
      {
        id: reviewId,
        source,
        effects: {
          siblings: siblings.map((entry) => ({ cardId: entry.id, previous: entry.autoBurial })),
          markedLeech,
        },
        cardId: id,
        rating,
        reviewedAt: now.toISOString(),
        nextDue: result.card.due.toISOString(),
        studyDay: localDay(now),
        kind:
          card.schedule.state === State.New
            ? 'new'
            : card.schedule.state === State.Review
              ? 'review'
              : 'learning',
        previous: { schedule: card.schedule, updatedAt: card.updatedAt },
      },
    ],
  }
}
export function undoReview(library: Library): Library {
  const last = library.reviews.at(-1)
  if (!last?.previous) throw new Error('没有可撤销的评分。旧版导入的记录不支持撤销。')
  const current = library.cards.find((card) => card.id === last.cardId)
  if (!current || current.schedule.last_review !== last.reviewedAt)
    throw new Error('卡片进度已变化，无法撤销这次评分。')
  return {
    ...library,
    cards: library.cards.map((card) =>
      card.id === last.cardId
        ? {
            ...card,
            schedule: last.previous!.schedule,
            updatedAt: last.previous!.updatedAt,
            leech: last.effects?.markedLeech ? false : card.leech,
          }
        : card.autoBurial?.reviewId === last.id
          ? {
              ...card,
              autoBurial: last.effects?.siblings.find((entry) => entry.cardId === card.id)
                ?.previous,
            }
          : card,
    ),
    reviews: library.reviews.slice(0, -1),
  }
}
export type CardAction = 'suspend' | 'resume' | 'bury' | 'unbury' | 'clearLeech'
export function changeCards(
  library: Library,
  ids: Set<string>,
  action: CardAction,
  now = new Date(),
): Library {
  return {
    ...library,
    cards: library.cards.map((card) =>
      ids.has(card.id)
        ? {
            ...card,
            ...(action === 'suspend'
              ? { suspended: true }
              : action === 'resume'
                ? { suspended: false }
                : action === 'clearLeech'
                  ? { leech: false }
                  : action === 'bury'
                    ? { buriedOn: localDay(now) }
                    : { buriedOn: undefined, autoBurial: undefined }),
          }
        : card,
    ),
  }
}
export function intervalLabel(due: Date, now = new Date()): string {
  const minutes = Math.max(1, Math.round((due.getTime() - now.getTime()) / 60_000))
  if (minutes < 60) return `${minutes} 分钟`
  if (minutes < 1_440) return `${Math.round(minutes / 60)} 小时`
  return `${Math.round(minutes / 1_440)} 天`
}
export function weekActivity(library: Library, now = new Date()) {
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(now)
    date.setDate(date.getDate() - (6 - index))
    const key = localDay(date)
    return {
      key,
      label: new Intl.DateTimeFormat('zh-CN', { weekday: 'short' }).format(date),
      count: library.reviews.filter((review) => review.studyDay === key).length,
    }
  })
}
