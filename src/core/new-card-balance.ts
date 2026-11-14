import { State } from 'ts-fsrs'
import { LocalizedError, msg } from '../i18n'
import { cardViews, type Library } from './model'
import { available, dailyUsage } from './scheduler'
import { scheduledStudyDayStart, studyDay } from './study-day'
import { studySettings } from './study-settings'

export interface NewCardBalanceOptions {
  ids: readonly string[]
  windowDays?: number
  startOffsetDays?: number
}
export interface NewCardBalancePlan {
  ids: string[]
  windowDays: number
  startOffsetDays: number
  studyDay: string
  baseline: string
  assignments: { cardId: string; deckId: string; previousDue: string; due: string }[]
  days: { day: string; due: string; existing: number; added: number }[]
  unallocated: string[]
}
const stale = () => new LocalizedError(msg('新卡或学习安排已变化，请重新预览。'))

/** Explicit planning only: ordinary creation and grading never scan or rebalance this window. */
export function previewNewCardBalance(
  library: Library,
  options: NewCardBalanceOptions,
  now = new Date(),
): NewCardBalancePlan {
  const settings = studySettings(library)
  const windowDays = options.windowDays ?? settings.newCardWindowDays
  const startOffsetDays = options.startOffsetDays ?? 1
  if (
    !options.ids.length ||
    options.ids.length > 10000 ||
    new Set(options.ids).size !== options.ids.length ||
    !Number.isInteger(windowDays) ||
    windowDays < 1 ||
    windowDays > 99 ||
    !Number.isInteger(startOffsetDays) ||
    startOffsetDays < 0 ||
    startOffsetDays > 365
  )
    throw stale()
  const views = cardViews(library)
  const cards = new Map(views.map((card) => [card.id, card]))
  const selected = new Set(options.ids)
  const targets = options.ids
    .map((id) => {
      const card = cards.get(id)
      if (
        !card ||
        card.schedule.state !== State.New ||
        card.schedule.reps !== 0 ||
        !available(card, now, settings)
      )
        throw stale()
      return card
    })
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
  const decks = new Map(library.decks.map((deck) => [deck.id, deck]))
  const day = studyDay(now, settings)
  const days = Array.from({ length: windowDays }, (_, index) => {
    const due = scheduledStudyDayStart(now, startOffsetDays + index, settings)
    return { day: studyDay(due, settings), due: due.toISOString(), existing: 0, added: 0 }
  })
  const byDay = new Map(days.map((entry, index) => [entry.day, index]))
  const introduced = dailyUsage(library, now)
  const newPerDeck = new Map(
    library.decks.map((deck) => [deck.id, Array(windowDays).fill(0) as number[]]),
  )
  if (startOffsetDays === 0)
    for (const [id, loads] of newPerDeck) loads[0] = introduced.get(id)?.new.size ?? 0
  for (const card of views) {
    if (selected.has(card.id) || card.suspended) continue
    const due = new Date(card.schedule.due)
    const dueDay = studyDay(due, settings)
    // Overdue work remains due today; it must not disappear from today's load.
    const index = byDay.get(dueDay < day ? day : dueDay)
    if (index === undefined || !available(card, new Date(days[index]!.due), settings)) continue
    days[index]!.existing++
    if (card.schedule.state === State.New && !introduced.get(card.deckId)?.new.has(card.id))
      newPerDeck.get(card.deckId)![index]!++
  }
  const assignments: NewCardBalancePlan['assignments'] = []
  const unallocated: string[] = []
  for (const card of targets) {
    const deck = decks.get(card.deckId)
    if (!deck) throw stale()
    const loads = newPerDeck.get(deck.id)!
    let chosen = -1
    for (let index = 0; index < days.length; index++) {
      if (loads[index]! >= deck.newLimit) continue
      if (
        chosen < 0 ||
        days[index]!.existing + days[index]!.added < days[chosen]!.existing + days[chosen]!.added
      )
        chosen = index
    }
    if (chosen < 0) {
      unallocated.push(card.id)
      continue
    }
    days[chosen]!.added++
    loads[chosen]!++
    assignments.push({
      cardId: card.id,
      deckId: card.deckId,
      previousDue: card.schedule.due,
      due: days[chosen]!.due,
    })
  }
  // A compact projection of all allocation inputs, not note bodies or full review history.
  // Exact comparison protects other cards' load changes as well as the selected cards.
  const baseline = JSON.stringify({
    day,
    hour: settings.dayStartHour,
    cards: views.map((card) => [
      card.id,
      card.noteId,
      card.deckId,
      card.schedule.due,
      card.schedule.state,
      card.schedule.reps,
      card.updatedAt,
      card.suspended,
      card.buriedOn,
      card.autoBurial,
    ]),
    decks: library.decks.map((deck) => [deck.id, deck.newLimit]),
    introduced: [...introduced].map(([id, entry]) => [id, [...entry.new]]),
  })
  return {
    ids: targets.map((card) => card.id),
    windowDays,
    startOffsetDays,
    studyDay: day,
    baseline,
    assignments,
    days,
    unallocated,
  }
}

/** Refuses stale, forged or partially allocatable plans instead of committing a half batch. */
export function applyNewCardBalance(
  library: Library,
  plan: NewCardBalancePlan,
  now = new Date(),
): Library {
  const current = previewNewCardBalance(library, plan, now)
  if (JSON.stringify(current) !== JSON.stringify(plan)) throw stale()
  if (current.unallocated.length)
    throw new LocalizedError(msg('安排窗口或新卡额度不足，请扩大窗口或减少选择后重新预览。'))
  const due = new Map(current.assignments.map((entry) => [entry.cardId, entry.due]))
  return {
    ...library,
    cards: library.cards.map((card) =>
      due.has(card.id) && card.schedule.due !== due.get(card.id)
        ? {
            ...card,
            schedule: { ...card.schedule, due: due.get(card.id)! },
            updatedAt: now.toISOString(),
          }
        : card,
    ),
  }
}
