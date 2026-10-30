import { z } from 'zod'
import { retiredNoteSchema, type RetiredNote } from '../desktop/retirement'
import { hasAttemptBody } from './practice-data'
import { mediaTypes, type Library, type Media, type Note } from './model'
import type { PluginData } from '../plugins/data'
import { referencedSource } from './source-data'
import {
  locatorMatchesReference,
  materialLocatorMatches,
  materialPathSchema,
} from './material-data'
import { readWorkspaceMarkdown } from '../workspace/markdown'

export const retiredBackupSchema = z.array(retiredNoteSchema).max(100_000)
export function retiredIdentity(entry: RetiredNote): string {
  const id = entry.note?.id ?? entry.cards[0]?.noteId
  if (!id || entry.cards.some((card) => card.noteId !== id))
    throw new Error('invalid-retired-backup')
  return id
}
export function validateRetiredBackup(library: Library, retired: RetiredNote[]) {
  retiredBackupSchema.parse(retired)
  const media = new Map(backupMedia(library, retired).map((item) => [item.id, item]))
  const sources = new Map(library.sources.map((source) => [source.id, source]))
  const owners = new Set<string>(),
    cards = new Set(library.cards.map((card) => card.id)),
    reviews = new Set(library.reviews.map((item) => item.id)),
    practices = new Set(library.practices.map((item) => item.id)),
    attempts = new Set(library.attempts.map((item) => item.id))
  const totals = { cards: 0, reviews: 0, practices: 0, attempts: 0 }
  for (const entry of retired) {
    const id = retiredIdentity(entry)
    if (owners.has(id)) throw new Error('invalid-retired-backup')
    if (!entry.note && !library.notes.some((note) => note.id === id))
      throw new Error('invalid-retired-backup')
    owners.add(id)
    const ownCards = new Set(entry.cards.map((card) => card.id)),
      ownPractices = new Set(entry.practices.map((item) => item.id))
    if (new Set(entry.cards.map((card) => card.variant)).size !== entry.cards.length)
      throw new Error('invalid-retired-backup')
    for (const [kind, seen] of [
      ['cards', cards],
      ['reviews', reviews],
      ['practices', practices],
      ['attempts', attempts],
    ] as const)
      for (const value of entry[kind]) {
        if (seen.has(value.id)) throw new Error('invalid-retired-backup')
        seen.add(value.id)
        totals[kind]++
      }
    if (
      entry.reviews.some((item) => !ownCards.has(item.cardId)) ||
      entry.practices.some((item) => !ownCards.has(item.cardId)) ||
      entry.attempts.some((item) => !ownPractices.has(item.practiceId) || !hasAttemptBody(item))
    )
      throw new Error('invalid-retired-backup')
    if (
      entry.reviews.some(
        (review) =>
          review.practiceId &&
          !entry.practices.some(
            (practice) => practice.id === review.practiceId && practice.cardId === review.cardId,
          ),
      ) ||
      entry.practices.some(
        (practice) =>
          practice.reviewId &&
          !entry.reviews.some(
            (review) =>
              review.id === practice.reviewId &&
              review.practiceId === practice.id &&
              review.cardId === practice.cardId &&
              review.rating === practice.rating,
          ),
      ) ||
      entry.attempts.some(
        (attempt) =>
          (['pending', 'completed'].includes(attempt.status) && !attempt.submissionId) ||
          (attempt.status === 'completed') !== !!attempt.result,
      )
    )
      throw new Error('invalid-retired-backup')
    const note = entry.note
    if (note) {
      for (const id of [
        ...note.frontMedia,
        ...note.backMedia,
        ...(note.inlineMedia ?? []).map((ref) => ref.mediaId),
      ])
        if (!mediaTypes.includes(media.get(id)?.type as (typeof mediaTypes)[number]))
          throw new Error('invalid-retired-media-reference')
      const excerpt = note.excerpt
      const source = excerpt && sources.get(excerpt.sourceId),
        snapshot = source && excerpt && referencedSource(source, excerpt)
      if (
        excerpt &&
        (!snapshot ||
          excerpt.end > snapshot.characters ||
          !media.has(snapshot.mediaId) ||
          (excerpt.locator &&
            (!materialLocatorMatches(snapshot, excerpt.locator) ||
              !locatorMatchesReference(excerpt, excerpt.locator))))
      )
        throw new Error('invalid-retired-source-reference')
      for (const locator of Object.values(note.plugin?.variantLocators ?? {}))
        if (
          !excerpt ||
          !snapshot ||
          !materialLocatorMatches(snapshot, locator) ||
          !locatorMatchesReference(excerpt, locator)
        )
          throw new Error('invalid-retired-source-reference')
    }
    if (entry.document) {
      const document = entry.document,
        parsed = readWorkspaceMarkdown(document.raw)
      if (
        !note ||
        document.id !== id ||
        !document.path.startsWith('notes/') ||
        !materialPathSchema.safeParse(document.path).success ||
        !/^[a-f0-9]{64}$/.test(document.hash) ||
        parsed.status !== 'managed' ||
        parsed.document.identity.kind !== 'note' ||
        parsed.document.identity.id !== id
      )
        throw new Error('invalid-retired-document')
    }
  }
  if (
    totals.cards > 200_000 ||
    totals.reviews > 500_000 ||
    totals.practices > 100_000 ||
    totals.attempts > 500_000
  )
    throw new Error('invalid-retired-backup')
  backupMedia(library, retired)
}
export function backupMedia(library: Library, retired: readonly RetiredNote[]): Media[] {
  const media = new Map(library.media.map((item) => [item.id, item]))
  for (const entry of retired)
    for (const item of entry.media) {
      const previous = media.get(item.id)
      if (previous && JSON.stringify(previous) !== JSON.stringify(item))
        throw new Error('invalid-retired-backup')
      media.set(item.id, item)
    }
  return [...media.values()]
}
export type RetiredRow = {
  owner: number
  kind: 'header' | 'cards' | 'reviews' | 'practices' | 'attempts' | 'media'
  value: unknown
}
export function* retiredRows(retired: readonly RetiredNote[]): Generator<RetiredRow> {
  for (const [owner, entry] of retired.entries()) {
    yield {
      owner,
      kind: 'header',
      value: { revision: entry.revision, note: entry.note, document: entry.document },
    }
    for (const kind of ['cards', 'reviews', 'practices', 'attempts', 'media'] as const)
      for (const value of entry[kind]) yield { owner, kind, value }
  }
}
export function collectRetiredRows(rows: unknown[]): RetiredNote[] {
  const result: Record<string, unknown>[] = []
  const schema = z.strictObject({
    owner: z.number().int().nonnegative().max(99_999),
    kind: z.enum(['header', 'cards', 'reviews', 'practices', 'attempts', 'media']),
    value: z.unknown(),
  })
  for (const raw of rows) {
    const row = schema.parse(raw)
    if (row.kind === 'header') {
      if (
        row.owner !== result.length ||
        !row.value ||
        typeof row.value !== 'object' ||
        Array.isArray(row.value)
      )
        throw new Error('invalid-retired-backup')
      result.push({ ...row.value, cards: [], reviews: [], practices: [], attempts: [], media: [] })
    } else {
      const entry = result[row.owner]
      if (!entry) throw new Error('invalid-retired-backup')
      ;(entry[row.kind] as unknown[]).push(row.value)
    }
  }
  return retiredBackupSchema.parse(result)
}
export function rekeyPortablePlugin(plugin: PluginData, ids: Map<string, string>): PluginData {
  return plugin.variantLocators
    ? {
        ...plugin,
        variantLocators: Object.fromEntries(
          Object.entries(plugin.variantLocators).map(([key, value]) => [
            key,
            { ...value, versionId: ids.get(value.versionId) ?? value.versionId },
          ]),
        ),
      }
    : plugin
}
export function rekeyPortableNote(note: Note, ids: Map<string, string>): Note {
  const locator = <T extends { versionId: string }>(value: T) => ({
    ...value,
    versionId: ids.get(value.versionId) ?? value.versionId,
  })
  return {
    ...note,
    plugin: note.plugin ? rekeyPortablePlugin(note.plugin, ids) : undefined,
    frontMedia: note.frontMedia.map((id) => ids.get(id)!),
    backMedia: note.backMedia.map((id) => ids.get(id)!),
    inlineMedia: note.inlineMedia?.map((ref) => ({ ...ref, mediaId: ids.get(ref.mediaId)! })),
    excerpt: note.excerpt
      ? {
          ...note.excerpt,
          ...(note.excerpt.mediaId
            ? { mediaId: ids.get(note.excerpt.mediaId) ?? note.excerpt.mediaId }
            : {}),
          ...(note.excerpt.locator ? { locator: locator(note.excerpt.locator) } : {}),
        }
      : undefined,
  }
}
