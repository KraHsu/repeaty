import type { Library } from './model'
import type { Attempt } from './practice-data'
import type { RetiredNote } from '../desktop/retirement'
import { referencedSource, sourceAtVersion } from './source-data'
import { materialLocatorMatches } from './material-data'

export function retiredSourceRisk(previous: Library, next: Library): boolean {
  if (previous.sources === next.sources) return false
  const sources = new Map(next.sources.map((source) => [source.id, source]))
  return previous.sources.some((source) => {
    const current = sources.get(source.id)
    if (!current) return true
    return [source, ...(source.versions ?? [])].some(
      (version) => !sourceAtVersion(current, version.mediaId),
    )
  })
}

/** A source deletion must not silently break the return path of an archived card. */
export function validateRetiredSources(previous: Library, next: Library, retired: RetiredNote[]) {
  const before = new Map(previous.sources.map((source) => [source.id, source])),
    after = new Map(next.sources.map((source) => [source.id, source]))
  for (const entry of retired) {
    const excerpt = entry.note?.excerpt
    if (excerpt) {
      const source = before.get(excerpt.sourceId),
        current = after.get(excerpt.sourceId),
        snapshot = source && referencedSource(source, excerpt)
      if (
        snapshot &&
        (!current ||
          !sourceAtVersion(current, snapshot.mediaId) ||
          referencedSource(current, excerpt)?.mediaId !== snapshot.mediaId)
      )
        throw new Error('该材料或旧版本仍被退役卡片引用，不能删除。请先恢复并处理对应卡片。')
    }
    for (const locator of Object.values(entry.note?.plugin?.variantLocators ?? {})) {
      const old = before.get(locator.sourceId),
        source = after.get(locator.sourceId),
        oldVersion = old && sourceAtVersion(old, locator.versionId),
        version = source && sourceAtVersion(source, locator.versionId)
      if (
        oldVersion &&
        materialLocatorMatches(oldVersion, locator) &&
        (!version || !materialLocatorMatches(version, locator))
      )
        throw new Error('该材料或旧版本仍被退役卡片引用，不能删除。请先恢复并处理对应卡片。')
    }
  }
}

/** Only called for structural edits; ratings never inspect archived bodies. */
export function retiredNoteIds(previous: Library, next: Library): Set<string> {
  const activeIds = new Set(next.cards.map((card) => card.id)),
    oldIds = new Set(previous.cards.map((card) => card.id)),
    activeNotes = new Set(next.notes.map((note) => note.id))
  return new Set([
    ...previous.cards.filter((card) => !activeIds.has(card.id)).map((card) => card.noteId),
    ...next.cards.filter((card) => !oldIds.has(card.id)).map((card) => card.noteId),
    ...previous.notes.filter((note) => !activeNotes.has(note.id)).map((note) => note.id),
  ])
}

/** Captures only the affected note's removed cards and expands only their attempt bodies. */
export async function captureRetiredNote(
  previous: Library,
  next: Library,
  id: string,
  prior: RetiredNote | undefined,
  revision: number,
  readAttempt: (id: string) => Promise<Attempt>,
  document: RetiredNote['document'] = prior?.document ?? null,
): Promise<RetiredNote | undefined> {
  const activeIds = new Set(next.cards.map((card) => card.id)),
    active = next.notes.some((note) => note.id === id)
  // Explicit note deletion keeps its established checkpoint/undo semantics.
  if (!active && !prior) return
  const removed = previous.cards.filter((card) => card.noteId === id && !activeIds.has(card.id)),
    removedIds = new Set(removed.map((card) => card.id)),
    note = previous.notes.find((note) => note.id === id) ?? prior?.note ?? null,
    cards = [...(prior?.cards ?? []).filter((card) => !activeIds.has(card.id)), ...removed]
  if (!cards.length && (active || !note)) return
  const cardIds = new Set(cards.map((card) => card.id)),
    reviews = [
      ...(prior?.reviews ?? []).filter((review) => cardIds.has(review.cardId)),
      ...previous.reviews.filter((review) => removedIds.has(review.cardId)),
    ],
    removedPractices = previous.practices.filter((practice) => removedIds.has(practice.cardId)),
    practices = [
      ...(prior?.practices ?? []).filter((practice) => cardIds.has(practice.cardId)),
      ...removedPractices,
    ],
    practiceIds = new Set(practices.map((practice) => practice.id)),
    attempts = (prior?.attempts ?? []).filter((attempt) => practiceIds.has(attempt.practiceId)),
    newPractices = new Set(removedPractices.map((practice) => practice.id))
  for (const attempt of previous.attempts.filter((attempt) => newPractices.has(attempt.practiceId)))
    attempts.push(await readAttempt(attempt.id))
  const media = new Map((prior?.media ?? []).map((meta) => [meta.id, meta])),
    mediaIds = new Set([
      ...(note?.frontMedia ?? []),
      ...(note?.backMedia ?? []),
      ...(note?.inlineMedia ?? []).map((ref) => ref.mediaId),
      ...(note?.excerpt ? [note.excerpt.mediaId] : []),
    ])
  for (const meta of previous.media) if (mediaIds.has(meta.id)) media.set(meta.id, meta)
  return {
    revision,
    note,
    document,
    cards,
    reviews,
    practices,
    attempts,
    media: [...media.values()],
  }
}
