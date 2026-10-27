import { z } from 'zod'
import {
  cardSchema,
  mediaSchema,
  noteSchema,
  reviewSchema,
  newCard,
  pruneMedia,
  variants,
  workspaceLibrarySchema,
  type Library,
  type NoteInput,
} from '../core/model'
import { attemptSchema, attemptSummarySchema, practiceSchema } from '../core/practice-data'
import { LocalizedError, msg } from '../i18n'
const documentSchema = z.object({
  kind: z.literal('note'),
  id: z.string(),
  path: z.string(),
  hash: z.string(),
  raw: z.string(),
})
export const retiredNoteSchema = z.object({
  revision: z.number().int().nonnegative(),
  note: noteSchema.nullable(),
  document: documentSchema.nullable(),
  cards: z.array(cardSchema),
  reviews: z.array(reviewSchema),
  practices: z.array(practiceSchema),
  attempts: z.array(z.union([attemptSchema, attemptSummarySchema])),
  media: z.array(mediaSchema),
})
export type RetiredNote = z.infer<typeof retiredNoteSchema>
export const retiredSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  retiredAt: z.iso.datetime(),
  path: z.string().nullable(),
  cards: z.number().int().nonnegative(),
})
export type RetiredSummary = z.infer<typeof retiredSummarySchema>
const stale = () => new LocalizedError(msg('学习库内容已变化，请重新载入。'))
export function noteLifecycle(
  library: Library,
  input: NoteInput,
  id: string,
  retired?: RetiredNote,
  allowRetire = false,
  now = new Date(),
) {
  const active = library.notes.find((note) => note.id === id),
    previous = active ?? retired?.note
  if (previous && previous.id !== id) throw stale()
  const note = noteSchema.parse({
    ...input,
    excerpt: input.excerpt ?? previous?.excerpt,
    id,
    createdAt: previous?.createdAt ?? now.toISOString(),
    updatedAt: now.toISOString(),
  })
  const wanted = variants(note),
    existing = library.cards.filter((card) => card.noteId === id)
  const removed = new Set(
    existing.filter((card) => !wanted.includes(card.variant)).map((card) => card.id),
  )
  if (removed.size && !allowRetire)
    throw new LocalizedError(msg('修改后部分卡片将暂不复习，已有记录会保留。请确认后继续。'))
  const used = new Set(existing.map((card) => card.variant)),
    restored: Library['cards'] = [],
    created: Library['cards'] = []
  for (const variant of wanted)
    if (!used.has(variant)) {
      const prior = retired?.cards.find(
        (card) =>
          card.noteId === id &&
          card.variant === variant &&
          !library.cards.some((active) => active.id === card.id),
      )
      if (prior) restored.push(prior)
      else created.push(newCard(id, variant, now))
    }
  const restoredIds = new Set(restored.map((card) => card.id)),
    removedPractices = new Set(
      library.practices
        .filter((practice) => removed.has(practice.cardId))
        .map((practice) => practice.id),
    )
  const practices = retired?.practices.filter((practice) => restoredIds.has(practice.cardId)) ?? [],
    practiceIds = new Set(practices.map((practice) => practice.id))
  function merge<T extends { id: string }>(
    current: T[],
    old: T[],
    date: (value: T) => string,
  ): T[] {
    if (!old.length) return current
    const ids = new Set(current.map((value) => value.id))
    if (old.some((value) => ids.has(value.id))) throw stale()
    return [...current, ...old].sort((a, b) => Date.parse(date(a)) - Date.parse(date(b)))
  }
  const media = new Map(library.media.map((meta) => [meta.id, meta]))
  for (const meta of retired?.media ?? [])
    if ([...note.frontMedia, ...note.backMedia].includes(meta.id) && !media.has(meta.id))
      media.set(meta.id, meta)
  const next = pruneMedia({
    ...library,
    notes: active
      ? library.notes.map((value) => (value.id === id ? note : value))
      : [...library.notes, note],
    cards: [...library.cards.filter((card) => !removed.has(card.id)), ...restored, ...created],
    reviews: merge(
      library.reviews.filter((review) => !removed.has(review.cardId)),
      retired?.reviews.filter((review) => restoredIds.has(review.cardId)) ?? [],
      (review) => review.reviewedAt,
    ),
    practices: merge(
      library.practices.filter((practice) => !removed.has(practice.cardId)),
      practices,
      (practice) => practice.startedAt,
    ),
    attempts: merge(
      library.attempts.filter((attempt) => !removedPractices.has(attempt.practiceId)),
      retired?.attempts.filter((attempt) => practiceIds.has(attempt.practiceId)) ?? [],
      (attempt) => attempt.submittedAt,
    ),
    media: [...media.values()],
  })
  workspaceLibrarySchema.parse(next)
  return {
    library: next,
    keep: existing.length - removed.size,
    retire: removed.size,
    restore: restored.length,
    create: created.length,
  }
}
