import { LocalizedError, msg } from '../i18n'
import type { Library } from './model'
import {
  sourceSchema,
  type Source,
  type SourceArrangement,
  type SourceBatchAction,
  type SourceTarget,
} from './source-data'
import { arrangeSource } from './source-queue'

export interface ReadingUndo {
  id: string
  scope: string
  changes: { id: string; mediaId: string; before: SourceArrangement; after: SourceArrangement }[]
}
export function sourceArrangement(source: Source): SourceArrangement {
  return {
    ...(source.queue ? { queue: { ...source.queue } } : {}),
    ...(source.priority ? { priority: source.priority } : {}),
    ...(source.readingIntervalDays ? { readingIntervalDays: source.readingIntervalDays } : {}),
    ...(source.adaptiveReading ? { adaptiveReading: { ...source.adaptiveReading } } : {}),
  }
}
const same = (a: SourceArrangement, b: SourceArrangement) =>
  a.priority === b.priority &&
  a.readingIntervalDays === b.readingIntervalDays &&
  a.adaptiveReading?.intervalDays === b.adaptiveReading?.intervalDays &&
  a.adaptiveReading?.factor === b.adaptiveReading?.factor &&
  a.adaptiveReading?.lastReadOn === b.adaptiveReading?.lastReadOn &&
  a.adaptiveReading?.readCount === b.adaptiveReading?.readCount &&
  a.adaptiveReading?.feedback === b.adaptiveReading?.feedback &&
  a.queue?.state === b.queue?.state &&
  a.queue?.availableOn === b.queue?.availableOn
const stale = () => new LocalizedError(msg('材料或阅读安排已变化，请重新选择。'))

/** Evaluate against one snapshot, then replace all targets together; never partially mutate a library. */
export function arrangeSources(
  library: Library,
  targets: SourceTarget[],
  action: SourceBatchAction,
  at = new Date(),
): Library {
  if (
    !targets.length ||
    targets.length > 10_000 ||
    new Set(targets.map((t) => t.id)).size !== targets.length ||
    !['priority', 'defer', 'archive', 'restore'].includes(action.type)
  )
    throw stale()
  const current = new Map(library.sources.map((s) => [s.id, s]))
  const replacements = new Map<string, Source>()
  for (const target of targets) {
    const source = current.get(target.id)
    if (
      !source ||
      source.mediaId !== target.mediaId ||
      !same(sourceArrangement(source), target.before)
    )
      throw stale()
    const next = arrangeSource(
      { ...library, sources: [source] },
      source.id,
      source.mediaId,
      action,
      at,
    ).sources[0]!
    if (next !== source) replacements.set(source.id, next)
  }
  return replacements.size
    ? { ...library, sources: library.sources.map((s) => replacements.get(s.id) ?? s) }
    : library
}
export function readingUndoFor(
  before: Library,
  after: Library,
  scope: string,
): ReadingUndo | undefined {
  const previous = new Map(before.sources.map((s) => [s.id, s]))
  const changes: ReadingUndo['changes'] = []
  for (const source of after.sources) {
    const old = previous.get(source.id)
    if (old?.mediaId === source.mediaId && !same(sourceArrangement(old), sourceArrangement(source)))
      changes.push({
        id: source.id,
        mediaId: source.mediaId,
        before: sourceArrangement(old),
        after: sourceArrangement(source),
      })
  }
  return changes.length ? { id: crypto.randomUUID(), scope, changes } : undefined
}
export function canUndoReading(library: Library, undo?: ReadingUndo) {
  if (!undo?.changes.length) return false
  const sources = new Map(library.sources.map((s) => [s.id, s]))
  return undo.changes.every((change) => {
    const source = sources.get(change.id)
    return source?.mediaId === change.mediaId && same(sourceArrangement(source), change.after)
  })
}
/** Restore arrangements only; later text edits, positions and FSRS work are deliberately preserved. */
export function undoReading(library: Library, undo: ReadingUndo): Library {
  if (!canUndoReading(library, undo)) throw stale()
  const changes = new Map(undo.changes.map((change) => [change.id, change]))
  return {
    ...library,
    sources: library.sources.map((source) => {
      const change = changes.get(source.id)
      if (!change) return source
      const {
        queue: _queue,
        priority: _priority,
        readingIntervalDays: _interval,
        adaptiveReading: _adaptive,
        ...rest
      } = source
      return sourceSchema.parse({ ...rest, ...change.before })
    }),
  }
}
