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

/** Unscheduled snapshots are immediately available. Reading visits never reorder the queue. */
export function queuedSources(sources: Source[], view: SourceQueueView, today: string, query = '') {
  const ranks = { ready: 0, deferred: 1, archived: 2 }
  const search = query.toLocaleLowerCase()
  return sources
    .filter(
      (source) =>
        (view === 'all' || sourceQueueState(source, today) === view) &&
        source.title.toLocaleLowerCase().includes(search),
    )
    .sort(
      (a, b) =>
        ranks[sourceQueueState(a, today)] - ranks[sourceQueueState(b, today)] ||
        (a.queue?.availableOn ?? localDay(new Date(a.createdAt))).localeCompare(
          b.queue?.availableOn ?? localDay(new Date(b.createdAt)),
        ) ||
        a.createdAt.localeCompare(b.createdAt) ||
        a.id.localeCompare(b.id),
    )
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
  if (!parsed.success) throw new LocalizedError(msg('请选择有效的阅读日期。'))
  const action = parsed.data,
    today = localDay(now)
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
