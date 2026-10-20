import { LocalizedError, msg } from '../i18n'
import { localDay, type Library } from './model'
import {
  sourceQueueActionSchema,
  sourceSchema,
  type Source,
  type SourceQueueAction,
} from './source-data'

export type SourceQueueState = 'ready' | 'deferred' | 'archived'
export type SourceQueueView = SourceQueueState | 'all'

export function sourceQueueState(source: Source, today: string): SourceQueueState {
  if (source.queue?.state === 'archived') return 'archived'
  return source.queue && source.queue.availableOn > today ? 'deferred' : 'ready'
}

/** Priority orders ready sources only; future dates and archives keep their eligibility. */
export function queuedSources(sources: Source[], view: SourceQueueView, today: string, query = '') {
  const ranks = { ready: 0, deferred: 1, archived: 2 }
  const priorities = { high: 0, normal: 1, low: 2 }
  const search = query.toLocaleLowerCase()
  return sources
    .filter(
      (source) =>
        (view === 'all' || sourceQueueState(source, today) === view) &&
        source.title.toLocaleLowerCase().includes(search),
    )
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
  if (action.type === 'defer' && action.date <= today)
    throw new LocalizedError(msg('请选择今天之后的阅读日期。'))
  const queue =
    action.type === 'archive'
      ? { state: 'archived' as const, availableOn: source.queue?.availableOn ?? today }
      : { state: 'active' as const, availableOn: action.type === 'defer' ? action.date : today }
  if (source.queue?.state === queue.state && source.queue.availableOn === queue.availableOn)
    return library
  const next = sourceSchema.parse({ ...source, queue })
  return { ...library, sources: library.sources.map((entry) => (entry.id === id ? next : entry)) }
}
