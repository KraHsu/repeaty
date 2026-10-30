import type { Source } from './source-data'
import { queuedSources, sourceQueueState, type SourceFilter } from './source-queue'

/** A temporary snapshot of one pass through the ready queue, never part of the library. */
export interface ReadingRound {
  entries: ReadonlyArray<{ sourceId: string; mediaId: string }>
  cursor: number
}

export function startReadingRound(
  sources: Source[],
  today: string,
  filter: SourceFilter = {},
): ReadingRound {
  return {
    entries: queuedSources(sources, 'ready', today, filter).map((source) => ({
      sourceId: source.id,
      mediaId: source.mediaId,
    })),
    cursor: 0,
  }
}

/** Deleted, replaced or no longer ready snapshots are skipped without writing to them. */
export function reconcileReadingRound(round: ReadingRound, sources: Source[], today: string) {
  const current = new Map(sources.map((source) => [source.id, source]))
  let cursor = round.cursor
  while (cursor < round.entries.length) {
    const entry = round.entries[cursor]!,
      source = current.get(entry.sourceId)
    if (source?.mediaId === entry.mediaId && sourceQueueState(source, today, sources) === 'ready')
      break
    cursor++
  }
  return cursor === round.cursor ? round : { ...round, cursor }
}

export function advanceReadingRound(round: ReadingRound, sources: Source[], today: string) {
  if (round.cursor === round.entries.length) return round
  return reconcileReadingRound({ ...round, cursor: round.cursor + 1 }, sources, today)
}
