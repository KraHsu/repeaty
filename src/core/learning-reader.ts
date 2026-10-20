import { z } from 'zod'
import { dueCards, blockedByLimit, dayKey, type CardEligibility } from './scheduler'
import type { Library } from './model'

export type LearningQuery = {
  tool:
    | 'repeaty_due_cards'
    | 'repeaty_study_stats'
    | 'repeaty_practice_history'
    | 'repeaty_selected_excerpt'
    | 'repeaty_propose_cards'
  arguments: Record<string, unknown>
}
export type LearningReader = {
  scope: { readonly value: string }
  ready: { readonly value: boolean }
  busy: { readonly value: boolean }
  readLearning(query: LearningQuery, expectedScope: string): unknown
  localLearningSnapshot(expectedScope: string): LocalLearningSnapshot
}
export type LocalLearningSnapshot = { library: Library; revision: number; scope: string }
export type LearningReadError =
  | 'library-unavailable'
  | 'library-changed'
  | 'invalid-arguments'
  | 'unsupported-query'
  | 'selection-unavailable'
  | 'draft-limit'
  | 'request-conflict'

export class LearningQueryError extends Error {
  constructor(readonly code: LearningReadError) {
    super(code)
  }
}

const revision = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional()
const page = {
  offset: z.number().int().min(0).max(300_000).default(0),
  limit: z.number().int().min(1).max(50).default(20),
  revision,
}
const dueArguments = z.strictObject({ ...page, deckId: z.string().min(1).max(100).optional() })
const historyArguments = z.strictObject({
  ...page,
  cardId: z.string().min(1).max(150).optional(),
})
const statsArguments = z.strictObject({ revision })

/** Projects one committed in-memory snapshot. It has no storage or mutation capability. */
export function readLearning(
  library: Library,
  currentRevision: number,
  query: LearningQuery,
  now = new Date(),
  eligible: CardEligibility = () => true,
) {
  const schema =
    query.tool === 'repeaty_due_cards'
      ? dueArguments
      : query.tool === 'repeaty_practice_history'
        ? historyArguments
        : query.tool === 'repeaty_study_stats'
          ? statsArguments
          : undefined
  if (!schema) throw new LearningQueryError('unsupported-query')
  const parsed = schema.safeParse(query.arguments)
  if (!parsed.success) throw new LearningQueryError('invalid-arguments')
  if (parsed.data.revision !== undefined && parsed.data.revision !== currentRevision)
    throw new LearningQueryError('library-changed')
  const context = {
    revision: currentRevision,
    generatedAt: now.toISOString(),
    localDate: dayKey(now),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  }
  if (query.tool === 'repeaty_due_cards') {
    const args = parsed.data as z.infer<typeof dueArguments>
    const decks = new Map(library.decks.map((deck) => [deck.id, deck.name]))
    const cards = dueCards(library, now, args.deckId, eligible)
    return {
      ...context,
      ...pagination(cards.length, args),
      items: cards.slice(args.offset, args.offset + args.limit).map((card) => ({
        id: card.id,
        noteId: card.noteId,
        deckId: card.deckId,
        deck: decks.get(card.deckId),
        type: card.type,
        variant: card.variant,
        question: card.front,
        format: card.format,
        tags: [...card.tags],
        dueAt: card.schedule.due,
        state: card.schedule.state,
        ...(card.plugin ? { plugin: { id: card.plugin.id, version: card.plugin.version } } : {}),
      })),
    }
  }
  if (query.tool === 'repeaty_practice_history') {
    const args = parsed.data as z.infer<typeof historyArguments>
    const counts = new Map<string, number>()
    const latest = new Map<string, Library['attempts'][number]>()
    for (const attempt of library.attempts) {
      counts.set(attempt.practiceId, (counts.get(attempt.practiceId) ?? 0) + 1)
      const previous = latest.get(attempt.practiceId)
      if (
        !previous ||
        attempt.submittedAt > previous.submittedAt ||
        (attempt.submittedAt === previous.submittedAt && attempt.id > previous.id)
      )
        latest.set(attempt.practiceId, attempt)
    }
    const practices = library.practices
      .filter((entry) => !args.cardId || entry.cardId === args.cardId)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt) || b.id.localeCompare(a.id))
    return {
      ...context,
      ...pagination(practices.length, args),
      items: practices.slice(args.offset, args.offset + args.limit).map((practice) => {
        const attempt = latest.get(practice.id)
        return {
          id: practice.id,
          cardId: practice.cardId,
          question: practice.question.front,
          plugin: { id: practice.question.plugin.id, version: practice.question.plugin.version },
          startedAt: practice.startedAt,
          completedAt: practice.completedAt,
          completion: practice.completion,
          rating: practice.rating,
          ratingUndoneAt: practice.ratingUndoneAt,
          answerSeen: practice.answerSeen,
          attemptCount: counts.get(practice.id) ?? 0,
          ...(attempt
            ? {
                lastAttempt: {
                  submittedAt: attempt.submittedAt,
                  language: attempt.language,
                  elapsedMs: attempt.elapsedMs,
                  status: attempt.status,
                  ...(attempt.result
                    ? {
                        result: {
                          outcome: attempt.result.outcome,
                          status: attempt.result.status,
                          runtime: attempt.result.runtime,
                          memory: attempt.result.memory,
                        },
                      }
                    : {}),
                },
              }
            : {}),
        }
      }),
    }
  }
  const due = dueCards(library, now, undefined, eligible)
  const today = library.reviews.filter((entry) => entry.studyDay === context.localDate)
  return {
    ...context,
    totals: {
      decks: library.decks.length,
      notes: library.notes.length,
      cards: library.cards.length,
      practices: library.practices.length,
    },
    due: {
      total: due.length,
      new: due.filter((card) => card.schedule.state === 0).length,
      review: due.filter((card) => card.schedule.state === 2).length,
      learning: due.filter((card) => [1, 3].includes(card.schedule.state)).length,
      limited: blockedByLimit(library, now, undefined, eligible),
    },
    today: {
      reviews: today.length,
      ratings: {
        again: today.filter((entry) => entry.rating === 1).length,
        hard: today.filter((entry) => entry.rating === 2).length,
        good: today.filter((entry) => entry.rating === 3).length,
        easy: today.filter((entry) => entry.rating === 4).length,
      },
    },
  }
}

function pagination(total: number, args: { offset: number; limit: number }) {
  return {
    total,
    offset: args.offset,
    limit: args.limit,
    nextOffset: args.offset + args.limit < total ? args.offset + args.limit : null,
  }
}
