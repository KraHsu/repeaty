import { LocalizedError, msg } from '../i18n'
import { localDay, type Library } from './model'
import { studyDay, studyDayAfter } from './study-day'
import { studySettings, type StudySettings } from './study-settings'
import {
  createPriorityResolver,
  sourcePriorityGroup,
  weightedPriorityOrder,
} from './study-priority'
import { adaptiveReadingPlan, nextAdaptiveReading } from './adaptive-reading'
import { materialLocked } from './material-sequence'
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

export function filterSources(sources: Source[], filter: SourceFilter = {}, library?: Library) {
  const search = (filter.query ?? '').trim().toLocaleLowerCase()
  const resolver = library && createPriorityResolver(library)
  const priority = (source: Source) => {
    const effective = resolver?.source(source)
    return effective && (effective.numeric || studySettings(library).priorityMode === 'weighted')
      ? sourcePriorityGroup(effective.value)
      : (source.priority ?? 'normal')
  }
  return sources.filter(
    (source) =>
      (!filter.kind || filter.kind === 'all' || (source.kind ?? 'original') === filter.kind) &&
      (!filter.priority || filter.priority === 'all' || priority(source) === filter.priority) &&
      source.title.toLocaleLowerCase().includes(search),
  )
}

export function sourceQueueState(
  source: Source,
  today: string,
  sources: readonly Source[] = [],
): SourceQueueState {
  if (source.inbox) return 'archived'
  if (source.queue?.state === 'archived') return 'archived'
  if (source.studySequence?.completed) return 'archived'
  if (source.document?.container || materialLocked(source, sources)) return 'deferred'
  return source.queue && source.queue.availableOn > today ? 'deferred' : 'ready'
}

/** Priority orders ready sources only; future dates and archives keep their eligibility. */
export function queuedSources(
  sources: Source[],
  view: SourceQueueView,
  today: string,
  filter: SourceFilter = {},
  library?: Library,
) {
  const ranks = { ready: 0, deferred: 1, archived: 2 }
  const priorities = { high: 0, normal: 1, low: 2 }
  const ordered = filterSources(
    sources.filter((source) => !source.inbox),
    filter,
    library,
  )
    .filter(
      (source) =>
        view === 'all' ||
        (!source.document?.container && sourceQueueState(source, today, sources) === view),
    )
    .map((source) => ({
      source,
      rank: ranks[sourceQueueState(source, today, sources)],
      priority:
        sourceQueueState(source, today, sources) === 'ready'
          ? priorities[source.priority ?? 'normal']
          : 0,
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
  if (!library) return ordered
  const resolver = createPriorityResolver(library)
  if (studySettings(library).priorityMode !== 'weighted') {
    const values = new Map(ordered.map((source) => [source.id, resolver.source(source)]))
    if (![...values.values()].some((priority) => priority.numeric)) return ordered
    const effective = (source: Source) =>
      values.get(source.id)!.numeric
        ? values.get(source.id)!.value
        : { high: 1, normal: 5, low: 9 }[source.priority ?? 'normal']
    return ordered.sort((a, b) => {
      const aRank = ranks[sourceQueueState(a, today, sources)],
        bRank = ranks[sourceQueueState(b, today, sources)]
      return aRank - bRank || (aRank === 0 ? effective(a) - effective(b) : 0)
    })
  }
  const ready = ordered.filter((source) => sourceQueueState(source, today, sources) === 'ready')
  const waiting = ordered.filter((source) => sourceQueueState(source, today, sources) !== 'ready')
  // Within a priority bucket, due order comes first; old three-level ranks are
  // used only by legacy mode and by the explicit legacy fallback in the resolver.
  ready.sort(
    (a, b) =>
      (a.queue?.availableOn ?? localDay(new Date(a.createdAt))).localeCompare(
        b.queue?.availableOn ?? localDay(new Date(b.createdAt)),
      ) ||
      a.createdAt.localeCompare(b.createdAt) ||
      a.id.localeCompare(b.id),
  )
  return [
    ...weightedPriorityOrder(
      ready,
      (source) => resolver.source(source).value,
      studySettings(library).priorityRatio,
      today,
    ),
    ...waiting,
  ]
}

export function nextReadingDay(
  now: Date,
  days = 1,
  settings?: Pick<StudySettings, 'dayStartHour'>,
) {
  return studyDayAfter(now, days, settings)
}

/** Only a confirmed read advances this ladder; custom dates keep its last step. */
export function nextReadingInterval(source: Source, now: Date, library?: Library) {
  const settings = studySettings(library)
  if (settings.readingMode === 'configured') {
    const previous = source.readingIntervalDays ?? source.adaptiveReading?.intervalDays
    const intervalDays =
      previous === undefined
        ? settings.readingInitialDays
        : Math.max(
            1,
            Math.min(
              settings.readingMaxDays,
              Math.round((previous * (settings.readingGrowthMin + settings.readingGrowthMax)) / 2),
            ),
          )
    return { intervalDays, date: nextReadingDay(now, intervalDays, settings) }
  }
  // Imported or older libraries may hold intervals off the ladder (2, 5 days…).
  // Advance to the next larger step instead of collapsing back to the first one.
  const index = READING_INTERVAL_DAYS.findIndex((days) => days > (source.readingIntervalDays ?? 0))
  const intervalDays =
    READING_INTERVAL_DAYS[index === -1 ? READING_INTERVAL_DAYS.length - 1 : index]!
  return { intervalDays, date: nextReadingDay(now, intervalDays, settings) }
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
    today = studyDay(now, studySettings(library))
  if (
    (action.type === 'read' || action.type === 'read-adaptive') &&
    (source.document?.container || materialLocked(source, library.sources))
  )
    throw new LocalizedError(msg('请先完成前面的章节，再安排此章节学习。'))
  if (action.type === 'priority') {
    if (
      (source.priority ?? 'normal') === action.priority &&
      source.studyPriority === undefined &&
      (source.priority !== undefined || studySettings(library).priorityMode === 'legacy')
    )
      return library
    const next = sourceSchema.parse({
      ...source,
      priority: action.priority,
      studyPriority: undefined,
    })
    return { ...library, sources: library.sources.map((entry) => (entry.id === id ? next : entry)) }
  }
  if (action.type === 'reset-interval') {
    if (source.readingIntervalDays === undefined && !source.adaptiveReading) return library
    const { readingIntervalDays: _interval, adaptiveReading: _adaptive, ...rest } = source
    const next = sourceSchema.parse(rest)
    return { ...library, sources: library.sources.map((entry) => (entry.id === id ? next : entry)) }
  }
  if (action.type === 'read') {
    const plan = nextReadingInterval(source, now, library)
    if (
      source.queue?.state === 'archived' ||
      action.intervalDays !== plan.intervalDays ||
      action.date !== plan.date
    )
      throw new LocalizedError(msg('阅读安排已变化，请重新确认下次日期。'))
  }
  if (action.type === 'read-adaptive') {
    const plan = adaptiveReadingPlan(source, action.feedback, now, studySettings(library))
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
        ? {
            adaptiveReading: nextAdaptiveReading(
              source,
              action.feedback,
              now,
              studySettings(library),
            ),
          }
        : {
            ...(adaptiveReading ? { adaptiveReading } : {}),
            ...(readingIntervalDays !== undefined ? { readingIntervalDays } : {}),
          }),
  })
  return {
    ...library,
    sources: library.sources.map((entry) => (entry.id === id ? next : entry)),
    ...(action.type === 'read' || action.type === 'read-adaptive'
      ? {
          studyEvents: [
            ...library.studyEvents,
            {
              id: crypto.randomUUID(),
              kind: 'reading' as const,
              occurredAt: now.toISOString(),
              studyDay: today,
              sourceId: source.id,
            },
          ],
        }
      : {}),
  }
}
