import { LocalizedError, msg } from '../i18n'
import { localDay, type Library } from './model'
import { adaptiveReadingPlan, nextAdaptiveReading } from './adaptive-reading'
import {
  sourceQueueActionSchema,
  sourceSchema,
  READING_INTERVAL_DAYS,
  type Source,
  type SourcePriority,
  type SourceQueueAction,
} from './source-data'

export type SourceQueueState = 'ready' | 'deferred' | 'archived'
export type SourceQueueView = SourceQueueState | 'all'

/** A temporary list filter; original snapshots have no stored kind. */
export interface SourceFilter {
  query?: string
  kind?: 'all' | 'original' | 'excerpt'
  priority?: 'all' | SourcePriority
}

export function filterSources(sources: Source[], filter: SourceFilter = {}) {
  const search = (filter.query ?? '').trim().toLocaleLowerCase()
  return sources.filter(
    (source) =>
      (!filter.kind || filter.kind === 'all' || (source.kind ?? 'original') === filter.kind) &&
      (!filter.priority ||
        filter.priority === 'all' ||
        (source.priority ?? 'normal') === filter.priority) &&
      source.title.toLocaleLowerCase().includes(search),
  )
}

export function sourceQueueState(source: Source, today: string): SourceQueueState {
  if (source.queue?.state === 'archived') return 'archived'
  return source.queue && source.queue.availableOn > today ? 'deferred' : 'ready'
}

/** Priority orders ready sources only; future dates and archives keep their eligibility. */
export function queuedSources(
  sources: Source[],
  view: SourceQueueView,
  today: string,
  filter: SourceFilter = {},
) {
  const ranks = { ready: 0, deferred: 1, archived: 2 }
  const priorities = { high: 0, normal: 1, low: 2 }
  return filterSources(sources, filter)
    .filter((source) => view === 'all' || sourceQueueState(source, today) === view)
    .map((source) => ({
      source,
      rank: ranks[sourceQueueState(source, today)],
      priority:
        sourceQueueState(source, today) === 'ready' ? priorities[source.priority ?? 'normal'] : 0,
      date: source.queue?.availableOn ?? localDay(new Date(source.createdAt)),
    }))
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        a.priority - b.priority ||
        a.date.localeCompare(b.date) ||
        a.source.createdAt.localeCompare(b.source.createdAt) ||
        a.source.id.localeCompare(b.source.id),
    )
    .map((entry) => entry.source)
}

export function nextReadingDay(now: Date, days = 1) {
  const date = new Date(now)
  date.setDate(date.getDate() + days)
  return localDay(date)
}

/** Only a confirmed read advances this ladder; custom dates keep its last step. */
export function nextReadingInterval(source: Source, now: Date) {
  const index =
    source.readingIntervalDays === undefined
      ? 0
      : Math.min(
          READING_INTERVAL_DAYS.indexOf(source.readingIntervalDays) + 1,
          READING_INTERVAL_DAYS.length - 1,
        )
  const intervalDays = READING_INTERVAL_DAYS[index]!
  return { intervalDays, date: nextReadingDay(now, intervalDays) }
}

export function arrangeSource(
  library: Library,
  id: string,
  mediaId: string,
  input: SourceQueueAction,
  now = new Date(),
): Library {
  const source = library.sources.find((entry) => entry.id === id)
  if (!source || source.mediaId !== mediaId)
    throw new LocalizedError(msg('材料已变化，请重新打开后继续阅读。'))
  const parsed = sourceQueueActionSchema.safeParse(input)
  if (!parsed.success) throw new LocalizedError(msg('阅读安排无效，请重新选择。'))
  const action = parsed.data,
    today = localDay(now)
  if (action.type === 'priority') {
    if ((source.priority ?? 'normal') === action.priority) return library
    const next = sourceSchema.parse({ ...source, priority: action.priority })
    return { ...library, sources: library.sources.map((entry) => (entry.id === id ? next : entry)) }
  }
  if (action.type === 'reset-interval') {
    if (source.readingIntervalDays === undefined && !source.adaptiveReading) return library
    const { readingIntervalDays: _interval, adaptiveReading: _adaptive, ...rest } = source
    const next = sourceSchema.parse(rest)
    return { ...library, sources: library.sources.map((entry) => (entry.id === id ? next : entry)) }
  }
  if (action.type === 'read') {
    const plan = nextReadingInterval(source, now)
    if (
      source.queue?.state === 'archived' ||
      action.intervalDays !== plan.intervalDays ||
      action.date !== plan.date
    )
      throw new LocalizedError(msg('阅读安排已变化，请重新确认下次日期。'))
  }
  if (action.type === 'read-adaptive') {
    const plan = adaptiveReadingPlan(source, action.feedback, now)
    if (
      source.queue?.state === 'archived' ||
      action.intervalDays !== plan.intervalDays ||
      action.date !== plan.date ||
      action.expectedReadCount !== plan.expectedReadCount
    )
      throw new LocalizedError(msg('阅读安排已变化，请重新确认下次日期。'))
  }
  if (
    (action.type === 'defer' || action.type === 'read' || action.type === 'read-adaptive') &&
    action.date <= today
  )
    throw new LocalizedError(msg('请选择今天之后的阅读日期。'))
  const queue =
    action.type === 'archive'
      ? { state: 'archived' as const, availableOn: source.queue?.availableOn ?? today }
      : {
          state: 'active' as const,
          availableOn:
            action.type === 'defer' || action.type === 'read' || action.type === 'read-adaptive'
              ? action.date
              : today,
        }
  if (
    source.queue?.state === queue.state &&
    source.queue.availableOn === queue.availableOn &&
    (action.type !== 'read' ||
      (source.readingIntervalDays === action.intervalDays && !source.adaptiveReading)) &&
    action.type !== 'read-adaptive'
  )
    return library
  const { adaptiveReading, readingIntervalDays, ...rest } = source
  const next = sourceSchema.parse({
    ...rest,
    queue,
    ...(action.type === 'read'
      ? { readingIntervalDays: action.intervalDays }
      : action.type === 'read-adaptive'
        ? { adaptiveReading: nextAdaptiveReading(source, action.feedback, now) }
        : { adaptiveReading, readingIntervalDays }),
  })
  return { ...library, sources: library.sources.map((entry) => (entry.id === id ? next : entry)) }
}
