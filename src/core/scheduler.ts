import { msg, LocalizedError, duration, locale } from '../i18n'
import { fsrs, State } from 'ts-fsrs'
import { assessmentSchema, type Assessment } from '../plugins/data'
import { finishPractice } from './practice'
import {
  cardViews,
  hydrateSchedule,
  serializeSchedule,
  type Card,
  type CardView,
  type Grade,
  type Deck,
  type Library,
} from './model'

import { studyDay, studyDayStart, nextStudyDayStart, scheduledStudyDayStart } from './study-day'
import {
  studySettings,
  effectiveFsrsWeights,
  DEFAULT_STUDY_SETTINGS,
  type StudySettings,
} from './study-settings'
import { createPriorityResolver, weightedPriorityOrder } from './study-priority'

function scheduler(retention = 0.9, settings = DEFAULT_STUDY_SETTINGS, weights?: number[]) {
  return fsrs({
    request_retention: retention,
    maximum_interval: settings.maxIntervalDays,
    enable_short_term: settings.enableShortTerm,
    enable_fuzz: false,
    ...(weights ? { w: weights } : {}),
  })
}
function normalizeDue<T extends { card: { due: Date; scheduled_days: number } }>(
  result: T,
  now: Date,
  settings: Readonly<StudySettings>,
): T {
  // FSRS can separate Hard/Good/Easy by adding a day after applying its own
  // maximum. A user-specified cap is still a hard bound, even when ratings tie.
  if (result.card.scheduled_days > settings.maxIntervalDays) {
    result.card.scheduled_days = settings.maxIntervalDays
    result.card.due = new Date(now.getTime() + settings.maxIntervalDays * 86_400_000)
  }
  // Midnight is the legacy mode: preserve exact FSRS due timestamps by default.
  if (settings.dayStartHour && result.card.scheduled_days >= 1)
    result.card.due = scheduledStudyDayStart(now, result.card.scheduled_days, settings)
  return result
}
export const dayKey = studyDay
export function isBuried(
  card: Card,
  now = new Date(),
  settings?: Pick<StudySettings, 'dayStartHour'>,
): boolean {
  const day = studyDay(now, settings)
  return card.buriedOn === day || card.autoBurial?.day === day
}
export function available(
  card: Card,
  now = new Date(),
  settings?: Pick<StudySettings, 'dayStartHour'>,
): boolean {
  return !card.suspended && !isBuried(card, now, settings)
}
export function dailyUsage(library: Library, now = new Date()) {
  const notes = new Map(library.notes.map((note) => [note.id, note.deckId]))
  const deckByCard = new Map(library.cards.map((card) => [card.id, notes.get(card.noteId)]))
  const settings = studySettings(library)
  const start = studyDayStart(now, settings).getTime()
  const end = nextStudyDayStart(now, settings).getTime()
  const usage = new Map(
    library.decks.map((deck) => [deck.id, { new: new Set<string>(), review: new Set<string>() }]),
  )
  for (const review of library.reviews) {
    const at = Date.parse(review.reviewedAt)
    if (at < start || at >= end) continue
    const deck = usage.get(deckByCard.get(review.cardId) ?? '')
    if (deck && (review.kind === 'new' || review.kind === 'review'))
      deck[review.kind].add(review.cardId)
  }
  return usage
}
export type CardEligibility = (card: CardView) => boolean
const allCards: CardEligibility = () => true
export function dueCards(
  library: Library,
  now = new Date(),
  deckId?: string,
  eligible: CardEligibility = allCards,
  views = cardViews(library),
): CardView[] {
  const settings = studySettings(library)
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
  let ordered = views
    .filter(
      (card) =>
        (!deckId || card.deckId === deckId) &&
        eligible(card) &&
        available(card, now, settings) &&
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
  const priority = createPriorityResolver(library)
  if (settings.priorityMode === 'weighted') {
    ordered = weightedPriorityOrder(
      ordered,
      (card) => priority.card(card).value,
      settings.priorityRatio,
      `${studyDay(now, settings)}:${library.reviews.length}`,
    )
  } else {
    const values = new Map(ordered.map((card) => [card.id, priority.card(card)]))
    if ([...values.values()].some((entry) => entry.numeric)) {
      const effective = (id: string) =>
        values.get(id)!.numeric ? values.get(id)!.value : settings.defaultPriority
      ordered.sort((a, b) => effective(a.id) - effective(b.id))
    }
  }
  return ordered.filter((card) => {
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
export function blockedByLimit(
  library: Library,
  now = new Date(),
  deckId?: string,
  canReview: CardEligibility = allCards,
  views = cardViews(library),
): number {
  const eligible = views.filter(
    (card) =>
      (!deckId || card.deckId === deckId) &&
      canReview(card) &&
      available(card, now, studySettings(library)) &&
      new Date(card.schedule.due) <= now,
  )
  return eligible.length - dueCards(library, now, deckId, canReview, views).length
}
export function previewReview(
  card: Card,
  now = new Date(),
  deck?: Pick<Deck, 'desiredRetention'> & { id?: string },
  library?: Library,
) {
  const settings = studySettings(library)
  const actualDeck =
    deck ??
    (library &&
      library.decks.find(
        (entry) => entry.id === library.notes.find((note) => note.id === card.noteId)?.deckId,
      ))
  const result = scheduler(
    actualDeck?.desiredRetention,
    settings,
    library ? effectiveFsrsWeights(library, actualDeck?.id) : undefined,
  ).repeat(hydrateSchedule(card.schedule), now)
  for (const rating of [1, 2, 3, 4] as const) normalizeDue(result[rating], now, settings)
  return result
}
export function reviewCard(
  library: Library,
  id: string,
  rating: Grade,
  now = new Date(),
  source: 'normal' | 'filtered' = 'normal',
  assessment?: Assessment,
  canReview: CardEligibility = allCards,
  practiceId?: string,
): Library {
  if (practiceId) {
    const practice = library.practices.find((entry) => entry.id === practiceId)
    if (practice?.reviewId && practice.cardId === id && practice.rating === rating) return library
  }
  const settings = studySettings(library)
  const card = library.cards.find((entry) => entry.id === id)
  if (!card) throw new LocalizedError(msg('卡片已不存在。'))
  const views = cardViews(library)
  if (
    !available(card, now, settings) ||
    !canReview(views.find((entry) => entry.id === id)!) ||
    (source === 'normal' &&
      !dueCards(library, now, undefined, canReview, views).some((entry) => entry.id === id))
  )
    throw new LocalizedError(msg('这张卡片尚未到期、已暂停或已达到今日额度。'))
  if (card.schedule.last_review && new Date(card.schedule.last_review) > now)
    throw new LocalizedError(msg('当前时间早于上次复习，请检查本机时间。'))
  const deckId = library.notes.find((note) => note.id === card.noteId)!.deckId
  const deck = library.decks.find((entry) => entry.id === deckId)!
  const result = normalizeDue(
    scheduler(deck.desiredRetention, settings, effectiveFsrsWeights(library, deckId)).next(
      hydrateSchedule(card.schedule),
      now,
      rating,
    ),
    now,
    settings,
  )
  const reviewId = crypto.randomUUID()
  const siblings = deck.burySiblings
    ? library.cards.filter(
        (entry) =>
          entry.noteId === card.noteId && entry.id !== id && available(entry, now, settings),
      )
    : []
  const siblingIds = new Set(siblings.map((entry) => entry.id))
  const markedLeech =
    !card.leech &&
    deck.leechThreshold > 0 &&
    rating === 1 &&
    result.card.lapses > card.schedule.lapses &&
    result.card.lapses >= deck.leechThreshold
  const updated: Library = {
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
          ? { ...entry, autoBurial: { day: studyDay(now, settings), reviewId } }
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
        assessment: assessment ? assessmentSchema.parse(assessment) : undefined,
        practiceId,
        reviewedAt: now.toISOString(),
        nextDue: result.card.due.toISOString(),
        studyDay: studyDay(now, settings),
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
  return practiceId ? finishPractice(updated, practiceId, id, assessment, reviewId, now) : updated
}
export function undoReview(library: Library): Library {
  const last = library.reviews.at(-1)
  if (!last?.previous) throw new LocalizedError(msg('没有可撤销的评分。旧版导入的记录不支持撤销。'))
  const current = library.cards.find((card) => card.id === last.cardId)
  if (!current || current.schedule.last_review !== last.reviewedAt)
    throw new LocalizedError(msg('卡片进度已变化，无法撤销这次评分。'))
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
    practices: library.practices.map((entry) =>
      entry.reviewId === last.id
        ? {
            ...entry,
            rating: undefined,
            reviewId: undefined,
            // `completedAt` stays: the practice was answered, and clearing it would make
            // the question mount treat the finished attempt as the current one.
            // `finishPractice` reopens a practice whose rating was undone.
            ratingUndoneAt: new Date().toISOString(),
          }
        : entry,
    ),
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
                    ? { buriedOn: studyDay(now, studySettings(library)) }
                    : { buriedOn: undefined, autoBurial: undefined }),
          }
        : card,
    ),
  }
}
export function intervalLabel(due: Date, now = new Date()): string {
  const minutes = Math.max(1, Math.round((due.getTime() - now.getTime()) / 60_000))
  if (minutes < 60) return duration(minutes, 'minute')
  if (minutes < 1_440) return duration(Math.round(minutes / 60), 'hour')
  return duration(Math.round(minutes / 1_440), 'day')
}
export function weekActivity(library: Library, now = new Date()) {
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(now)
    date.setDate(date.getDate() - (6 - index))
    const key = studyDay(date, studySettings(library))
    return {
      key,
      label: new Intl.DateTimeFormat(locale.value, { weekday: 'short' }).format(date),
      count: library.reviews.filter((review) => review.studyDay === key).length,
    }
  })
}
