import { msg, LocalizedError } from '../i18n'
import { practiceSchema, attemptSchema, type Practice, type Attempt } from './practice-data'
import type { Library, CardView } from './model'

export async function practiceContentRevision(card: Pick<CardView, 'front' | 'back' | 'plugin'>) {
  const snapshot = JSON.stringify([card.front, card.back, card.plugin], (_key, value) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : value,
  )
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(snapshot))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

const fail = () => new LocalizedError(msg('练习记录已变化，请重新打开题目后重试。'))
export function recordAttempt(
  library: Library,
  rawPractice: Practice,
  rawAttempt: Attempt,
): Library {
  const practice = practiceSchema.parse(rawPractice)
  const attempt = attemptSchema.parse(rawAttempt)
  const card = library.cards.find((entry) => entry.id === practice.cardId)
  const note = library.notes.find((entry) => entry.id === card?.noteId)
  const existing = library.practices.find((entry) => entry.id === practice.id)
  if (
    !card ||
    note?.plugin?.id !== practice.question.plugin.id ||
    attempt.practiceId !== practice.id
  )
    throw fail()
  if (
    existing &&
    (existing.cardId !== practice.cardId ||
      existing.contentRevision !== practice.contentRevision ||
      existing.completedAt)
  )
    throw fail()
  const prior = library.attempts.find((entry) => entry.id === attempt.id)
  if (prior) {
    if (
      prior.practiceId !== attempt.practiceId ||
      prior.code !== attempt.code ||
      prior.language !== attempt.language ||
      prior.submittedAt !== attempt.submittedAt ||
      prior.elapsedMs !== attempt.elapsedMs ||
      (prior.submissionId && prior.submissionId !== attempt.submissionId)
    )
      throw fail()
    if (JSON.stringify(prior) === JSON.stringify(attempt)) {
      return practice.answerSeen && !existing?.answerSeen
        ? {
            ...library,
            practices: library.practices.map((entry) =>
              entry.id === practice.id ? { ...entry, answerSeen: true } : entry,
            ),
          }
        : library
    }
    const transitions: Record<Attempt['status'], readonly string[]> = {
      submitting: ['pending', 'unknown', 'failed'],
      pending: ['completed'],
      unknown: [],
      failed: [],
      completed: [],
    }
    if (!transitions[prior.status].includes(attempt.status) || attempt.updatedAt < prior.updatedAt)
      throw fail()
  } else if (attempt.status !== 'submitting') throw fail()
  if (attempt.status === 'pending' && !attempt.submissionId) throw fail()
  if (attempt.status === 'completed' && (!attempt.submissionId || !attempt.result)) throw fail()
  if (attempt.status !== 'completed' && attempt.result) throw fail()
  const kept = existing ?? {
    ...practice,
    completedAt: undefined,
    completion: undefined,
    rating: undefined,
    reviewId: undefined,
    ratingUndoneAt: undefined,
    assessment: undefined,
  }
  return {
    ...library,
    practices: existing
      ? library.practices.map((entry) =>
          entry.id === practice.id
            ? { ...entry, answerSeen: entry.answerSeen || practice.answerSeen }
            : entry,
        )
      : [...library.practices, kept],
    attempts: prior
      ? library.attempts.map((entry) => (entry.id === attempt.id ? attempt : entry))
      : [...library.attempts, attempt],
  }
}

export function finishPractice(
  library: Library,
  practiceId: string,
  cardId: string,
  assessment: Practice['assessment'],
  reviewId?: string,
  now = new Date(),
): Library {
  const practice = library.practices.find((entry) => entry.id === practiceId)
  if (!practice || practice.cardId !== cardId || practice.completedAt) throw fail()
  if (
    library.attempts.some(
      (entry) =>
        entry.practiceId === practiceId && ['submitting', 'pending'].includes(entry.status),
    )
  )
    throw fail()
  const review = reviewId ? library.reviews.find((entry) => entry.id === reviewId) : undefined
  if (reviewId && (!review || review.cardId !== cardId || review.practiceId !== practiceId))
    throw fail()
  return {
    ...library,
    practices: library.practices.map((entry) =>
      entry.id === practiceId
        ? {
            ...entry,
            completedAt: now.toISOString(),
            completion: reviewId ? 'review' : 'practice',
            assessment,
            rating: review?.rating,
            reviewId,
            ratingUndoneAt: undefined,
          }
        : entry,
    ),
  }
}
