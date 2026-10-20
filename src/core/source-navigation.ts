import type { Library } from './model'
import {
  characterBoundary,
  type Source,
  type SourceExcerpt,
  type SourceOrigin,
} from './source-data'

export interface SavedExcerpt {
  source: Source
  origin: SourceOrigin
  cards: number
}

/** The root snapshot and existing references are enough; no child body reads are needed. */
export function excerptsForSource(library: Library, sourceId: string): SavedExcerpt[] {
  const root = library.sources.find((source) => source.id === sourceId)
  if (!root || root.kind === 'excerpt') return []
  const entries = new Map<string, SavedExcerpt>()
  for (const source of library.sources)
    if (source.kind === 'excerpt' && source.origin?.sourceId === sourceId)
      entries.set(source.id, { source, origin: source.origin, cards: 0 })
  const noteSources = new Map<string, SavedExcerpt>()
  for (const note of library.notes) {
    const entry = note.excerpt && entries.get(note.excerpt.sourceId)
    if (entry) noteSources.set(note.id, entry)
  }
  for (const card of library.cards) {
    const entry = noteSources.get(card.noteId)
    if (entry) entry.cards++
  }
  return [...entries.values()].sort(
    (a, b) =>
      a.origin.start - b.origin.start ||
      a.origin.end - b.origin.end ||
      a.source.createdAt.localeCompare(b.source.createdAt) ||
      a.source.id.localeCompare(b.source.id),
  )
}

export function matchingExcerpts(entries: SavedExcerpt[], selection?: SourceExcerpt) {
  if (!selection) return []
  return entries.filter(
    ({ origin }) =>
      origin.sourceId === selection.sourceId &&
      origin.start === selection.start &&
      origin.end === selection.end,
  )
}

export function excerptPreview(text: string, origin: SourceOrigin) {
  if (origin.start < 0 || origin.end > text.length || origin.end <= origin.start) return ''
  const quote = text.slice(origin.start, origin.end).replace(/\s+/gu, ' ').trim()
  const end = characterBoundary(quote, 160)
  return quote.slice(0, end) + (end < quote.length ? '…' : '')
}
