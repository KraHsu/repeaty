import type {
  StudyStatisticsDay,
  StudyStatisticsDetails,
  StudyStatisticsDetailsQuery,
  StudyStatisticsQuery,
  StudyStatisticsSnapshot,
  StudyStatisticsDetailItem,
} from '@repeaty/plugin-api'
import { cardViews, type CardView, type Library } from './model'
import { available } from './scheduler'
import { materialLocked } from './material-sequence'
import { studyDay } from './study-day'
import { studySettings } from './study-settings'

type Coverage = StudyStatisticsSnapshot['coverage']
type Kind = StudyStatisticsDetailsQuery['kind']
export interface StudyStatisticsContext {
  workspaceScope: string
  revision: number
  now?: Date
  coverage?: Coverage
  canReview?: (card: CardView) => boolean
}

const DAY = 86_400_000
function dateNumber(day: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new RangeError('统计日期无效。')
  const value = Date.parse(`${day}T00:00:00.000Z`)
  if (!Number.isFinite(value) || new Date(value).toISOString().slice(0, 10) !== day)
    throw new RangeError('统计日期无效。')
  return value
}
function range(query: StudyStatisticsQuery) {
  const first = dateNumber(query.from),
    last = dateNumber(query.to)
  const length = (last - first) / DAY + 1
  if (length < 1 || length > 366) throw new RangeError('一次最多查询连续 366 个学习日。')
  return Array.from({ length }, (_, index) =>
    new Date(first + index * DAY).toISOString().slice(0, 10),
  )
}
function covered(from: string | null, day: string) {
  return from !== null && day >= from
}
function labels(library: Library) {
  const notes = new Map(library.notes.map((note) => [note.id, note]))
  const cards = new Map(
    library.cards.map((card) => [
      card.id,
      notes.get(card.noteId)?.front.replace(/\s+/g, ' ').trim().slice(0, 160) || card.id,
    ]),
  )
  const sources = new Map(library.sources.map((source) => [source.id, source.title]))
  return { cards, sources }
}
function temporal(library: Library, context: StudyStatisticsContext) {
  const settings = studySettings(library),
    now = context.now ?? new Date(),
    today = studyDay(now, settings),
    since = settings.statisticsSince ? studyDay(new Date(settings.statisticsSince), settings) : null
  return {
    settings,
    now,
    today,
    coverage: context.coverage ?? {
      readingsFrom: since,
      practicesFrom: since,
      foregroundFrom: since,
    },
  }
}

interface Entry extends StudyStatisticsDetailItem {
  day: string
  kind: Kind
}

/** Summaries use persisted event identities; retries never count the same event twice. */
function* history(library: Library): Generator<Entry> {
  const names = labels(library),
    seen = new Set<string>()
  for (const review of library.reviews) {
    const key = `review:${review.id}`
    if (seen.has(key)) continue
    seen.add(key)
    yield {
      kind: 'reviews',
      day: review.studyDay,
      id: review.id,
      title: names.cards.get(review.cardId) ?? review.cardId,
      cardId: review.cardId,
      rating: review.rating,
      occurredAt: review.reviewedAt,
    }
  }
  for (const event of library.studyEvents) {
    const key = `event:${event.id}`
    if (seen.has(key)) continue
    seen.add(key)
    const reading = event.kind === 'reading'
    const target = reading ? event.sourceId : event.cardId
    yield {
      kind: reading ? 'readings' : 'practices',
      day: event.studyDay,
      id: event.id,
      title: (target && (reading ? names.sources : names.cards).get(target)) || target || event.id,
      sourceId: event.sourceId,
      cardId: event.cardId,
      occurredAt: event.occurredAt,
    }
  }
  // Plugin exercises already have their own persisted completion, including old
  // libraries. Ordinary pure-practice events above never duplicate these records.
  const settings = studySettings(library)
  for (const practice of library.practices) {
    const key = `practice:${practice.id}`
    if (practice.completion !== 'practice' || !practice.completedAt || seen.has(key)) continue
    seen.add(key)
    yield {
      kind: 'practices',
      day: practice.studyDay ?? studyDay(new Date(practice.completedAt), settings),
      id: practice.id,
      title: names.cards.get(practice.cardId) ?? practice.cardId,
      cardId: practice.cardId,
      occurredAt: practice.completedAt,
    }
  }
}

/** Saved due dates, never a simulated future rating or a claim about future work. */
function* planned(library: Library, context: StudyStatisticsContext): Generator<Entry> {
  const { now, today, settings } = temporal(library, context)
  const names = labels(library),
    seen = new Set<string>()
  for (const card of cardViews(library)) {
    const due = new Date(card.schedule.due),
      target = due > now ? due : now
    if (
      seen.has(`card:${card.id}`) ||
      !available(card, target, settings) ||
      (context.canReview && !context.canReview(card))
    )
      continue
    seen.add(`card:${card.id}`)
    yield {
      kind: 'scheduledCards',
      day: due > now ? studyDay(due, settings) : today,
      id: card.id,
      cardId: card.id,
      title: names.cards.get(card.id) ?? card.id,
      dueAt: card.schedule.due,
    }
  }
  for (const source of library.sources) {
    if (
      seen.has(`source:${source.id}`) ||
      source.inbox ||
      source.queue?.state === 'archived' ||
      source.studySequence?.completed ||
      source.document?.container ||
      materialLocked(source, library.sources)
    )
      continue
    seen.add(`source:${source.id}`)
    const scheduled = source.queue?.availableOn ?? studyDay(new Date(source.createdAt), settings)
    yield {
      kind: 'scheduledReadings',
      day: scheduled > today ? scheduled : today,
      id: source.id,
      sourceId: source.id,
      title: source.title,
      dueAt: scheduled,
    }
  }
}

export function studyStatistics(
  library: Library,
  query: StudyStatisticsQuery,
  context: StudyStatisticsContext,
): StudyStatisticsSnapshot {
  const { today, settings, coverage } = temporal(library, context)
  const days: StudyStatisticsDay[] = range(query).map((day) => {
    const activityKnown = day <= today && covered(coverage.foregroundFrom, day)
    return {
      day,
      reviews: 0,
      readings: day <= today && covered(coverage.readingsFrom, day) ? 0 : null,
      practices: day <= today && covered(coverage.practicesFrom, day) ? 0 : null,
      foregroundMs: activityKnown ? 0 : null,
      readingMs: activityKnown ? 0 : null,
      reviewMs: activityKnown ? 0 : null,
      practiceMs: activityKnown ? 0 : null,
      scheduledCards: 0,
      scheduledReadings: 0,
    }
  })
  const byDay = new Map(days.map((day) => [day.day, day]))
  for (const entry of history(library)) {
    const day = byDay.get(entry.day)
    if (!day || entry.day > today) continue
    const kind = entry.kind as 'reviews' | 'readings' | 'practices'
    if (day[kind] !== null) day[kind]++
  }
  for (const entry of planned(library, context)) {
    const day = byDay.get(entry.day)
    if (day) day[entry.kind as 'scheduledCards' | 'scheduledReadings']++
  }
  // Activity buckets are cumulative upserts. The maximum is correct even if a
  // replayed snapshot contains an older revision of the same session/day/mode.
  const activities = new Map<string, Library['studyActivity'][number]>()
  for (const activity of library.studyActivity) {
    const previous = activities.get(activity.id)
    if (!previous || previous.activeMs < activity.activeMs) activities.set(activity.id, activity)
  }
  for (const activity of activities.values()) {
    const day = byDay.get(activity.studyDay)
    if (
      !day ||
      day.foregroundMs === null ||
      !Number.isFinite(activity.activeMs) ||
      activity.activeMs < 0
    )
      continue
    const duration = Math.floor(activity.activeMs)
    day.foregroundMs += duration
    if (activity.kind === 'reading') day.readingMs! += duration
    if (activity.kind === 'review') day.reviewMs! += duration
    if (activity.kind === 'practice') day.practiceMs! += duration
  }
  return {
    workspaceScope: context.workspaceScope,
    revision: context.revision,
    today,
    dayStartHour: settings.dayStartHour,
    from: query.from,
    to: query.to,
    coverage,
    days,
  }
}

export function studyStatisticsDetails(
  library: Library,
  query: StudyStatisticsDetailsQuery,
  context: StudyStatisticsContext,
): StudyStatisticsDetails {
  dateNumber(query.day)
  const offset = query.offset ?? 0,
    limit = query.limit ?? 50
  if (
    !Number.isInteger(offset) ||
    offset < 0 ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 200
  )
    throw new RangeError('统计明细分页无效。')
  if (
    !['reviews', 'readings', 'practices', 'scheduledCards', 'scheduledReadings'].includes(
      query.kind,
    )
  )
    throw new RangeError('统计明细类型无效。')
  const { today } = temporal(library, context)
  const upcoming = query.kind === 'scheduledCards' || query.kind === 'scheduledReadings'
  const entries = [...(upcoming ? planned(library, context) : history(library))]
    .filter(
      (entry) =>
        entry.day === query.day && entry.kind === query.kind && (upcoming || entry.day <= today),
    )
    .sort(
      (left, right) =>
        (left.occurredAt ?? left.dueAt ?? '').localeCompare(
          right.occurredAt ?? right.dueAt ?? '',
        ) || left.id.localeCompare(right.id),
    )
  return {
    workspaceScope: context.workspaceScope,
    revision: context.revision,
    day: query.day,
    kind: query.kind,
    total: entries.length,
    offset,
    items: entries
      .slice(offset, offset + limit)
      .map(({ day: _day, kind: _kind, ...entry }) => entry),
    ...(offset + limit < entries.length ? { nextOffset: offset + limit } : {}),
  }
}
