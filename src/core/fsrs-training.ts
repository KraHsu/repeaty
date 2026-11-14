import { clipParameters, default_w, FSRSAlgorithm, State, type FSRSState } from 'ts-fsrs'
import type {
  StudyModelMetrics,
  StudyTrainingHistory,
  StudyTrainingSnapshot,
} from '@repeaty/plugin-api'
import type { Library, Review } from './model'
import { effectiveFsrsWeights, studySettings } from './study-settings'

const DAY_MS = 86_400_000
const LIMIT = {
  reviews: 100_000,
  histories: 20_000,
  historyReviews: 1024,
  items: 50_000,
  prefixReviews: 2_000_000,
}
const abort = (signal?: AbortSignal) => signal?.throwIfAborted()
const invalid = () => new Error('invalid-training-history')
const yieldTurn = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

/** Do not allow the scheduler's implicit migration/clipping to hide an invalid model. */
export function validateTrainingWeights(
  weights: readonly number[],
  enableShortTerm = true,
): number[] {
  if (
    !Array.isArray(weights) ||
    weights.length !== 21 ||
    weights.some((weight) => typeof weight !== 'number' || !Number.isFinite(weight))
  )
    throw new Error('invalid-fsrs-weights')
  const clipped = clipParameters([...weights], 1, enableShortTerm)
  // WASM trains in f32: e.g. its representation of 0.1 is 0.10000000149.
  if (weights.some((weight, index) => Math.abs(weight - clipped[index]!) > 1e-7))
    throw new Error('invalid-fsrs-weights')
  return clipped
}

function select(library: Library, deckId?: string, signal?: AbortSignal) {
  abort(signal)
  const settings = studySettings(library)
  const deck = deckId ? library.decks.find((item) => item.id === deckId) : undefined
  if (deckId && !deck) throw new Error('missing-deck')
  const eligibleDecks = new Set(
    library.decks
      .filter((item) => (deckId ? item.id === deckId : !item.activeFsrsModelId))
      .map((item) => item.id),
  )
  const notes = new Map(
    library.notes
      .filter((note) => eligibleDecks.has(note.deckId))
      .map((note) => [note.id, note.deckId]),
  )
  const cards = new Map(
    library.cards
      .filter((card) => notes.has(card.noteId))
      .map((card) => [card.id, notes.get(card.noteId)!]),
  )
  // Preserve recorded order for identical timestamps: random review IDs cannot
  // establish whether a same-millisecond reset happened before another rating.
  const reviews = library.reviews
    .filter((review) => cards.has(review.cardId))
    .sort((a, b) => a.reviewedAt.localeCompare(b.reviewedAt))
  if (reviews.length > LIMIT.reviews) throw new Error('training-limit')
  const selection = deckId ? deck?.activeFsrsModelId : settings.activeFsrsModelId
  const effective = selection ?? settings.activeFsrsModelId
  const weights = validateTrainingWeights(
    effectiveFsrsWeights(library, deckId) ?? [...default_w],
    settings.enableShortTerm,
  )
  // Only training inputs are included. Note bodies, due dates, general metadata,
  // foreground statistics, and unrelated candidate models cannot expire a run.
  const projection = {
    modelVersion: 'FSRS-6',
    deckId: deckId ?? null,
    selection: selection ?? null,
    effective: effective ?? null,
    weights,
    retention: deck?.desiredRetention ?? 0.9,
    maximumInterval: settings.maxIntervalDays,
    enableShortTerm: settings.enableShortTerm,
    dayStartHour: settings.dayStartHour,
    reviews: reviews.map((review) => [
      review.id,
      review.cardId,
      cards.get(review.cardId),
      review.rating,
      review.reviewedAt,
      review.kind,
      review.previous?.schedule.state,
      review.previous?.schedule.reps,
      review.previous?.schedule.last_review,
    ]),
  }
  return { reviews, projection, weights, selection, effective }
}

async function fingerprint(value: unknown, signal?: AbortSignal) {
  abort(signal)
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(value)),
  )
  abort(signal)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** Same projection as snapshots, without count thresholds or statistics revisions. */
export async function trainingFingerprint(library: Library, deckId?: string, signal?: AbortSignal) {
  return fingerprint(select(library, deckId, signal).projection, signal)
}

function historiesFrom(reviews: readonly Review[], signal?: AbortSignal) {
  const current = new Map<string, StudyTrainingHistory>()
  const histories: StudyTrainingHistory[] = []
  let included = 0
  for (let index = 0; index < reviews.length; index++) {
    if (index % 512 === 0) abort(signal)
    const review = reviews[index]!,
      previous = review.previous?.schedule
    const time = Date.parse(review.reviewedAt)
    if (!Number.isFinite(time) || ![1, 2, 3, 4].includes(review.rating)) throw invalid()
    // V1 migration labels the first observed record "new" even when it is only
    // a partial imported history. Require the recorded pre-rating new state.
    const fresh = previous?.state === State.New && previous.reps === 0 && !previous.last_review
    let history = current.get(review.cardId)
    if (fresh) {
      history = { cardId: review.cardId, ratings: [], elapsedDays: [], reviewedAt: [] }
      current.set(review.cardId, history)
      histories.push(history)
      if (histories.length > LIMIT.histories) throw new Error('training-limit')
    } else if (
      !history ||
      !previous ||
      previous.reps !== history.ratings.length ||
      previous.last_review !== history.reviewedAt.at(-1) ||
      previous.state === State.New ||
      review.kind === 'new'
    ) {
      // Gaps or resets without a recorded new state end the segment. Earlier
      // complete prefixes remain valid; later rows wait for a reliable reset.
      current.delete(review.cardId)
      continue
    }
    if (!history) continue
    if (history.ratings.length >= LIMIT.historyReviews) throw new Error('training-limit')
    const last = history.reviewedAt.at(-1)
    const elapsed = last ? Math.floor(time / DAY_MS) - Math.floor(Date.parse(last) / DAY_MS) : 0
    if (elapsed < 0 || elapsed > 36_500) throw invalid()
    history.ratings.push(review.rating)
    history.elapsedDays.push(elapsed)
    history.reviewedAt.push(review.reviewedAt)
    included++
  }
  return { histories, included, excluded: reviews.length - included }
}

function split(histories: readonly StudyTrainingHistory[]) {
  const times = histories
    .flatMap((history) => history.reviewedAt.map(Date.parse))
    .sort((a, b) => a - b)
  if (times.length < 1024) throw new Error('insufficient-training-history')
  const cutoff = times[Math.floor(times.length * 0.8)]!
  let training = 0,
    validation = 0,
    prefixReviews = 0
  for (const history of histories) {
    for (let index = 1; index < history.ratings.length; index++) {
      if (!history.elapsedDays[index]) continue
      if (Date.parse(history.reviewedAt[index]!) < cutoff) {
        training++
        prefixReviews += index + 1
      } else validation++
    }
  }
  if (training > LIMIT.items || prefixReviews > LIMIT.prefixReviews)
    throw new Error('training-limit')
  if (training < 512 || validation < 128) throw new Error('insufficient-training-history')
  return { cutoff, training, validation }
}

export async function trainingSnapshot(
  library: Library,
  context: {
    workspaceScope: string
    deckId?: string
    now?: Date
    signal?: AbortSignal
  },
): Promise<StudyTrainingSnapshot> {
  const selected = select(library, context.deckId, context.signal)
  const { histories, included, excluded } = historiesFrom(selected.reviews, context.signal)
  const { cutoff, training, validation } = split(histories)
  const snapshot: StudyTrainingSnapshot = {
    workspaceScope: context.workspaceScope,
    token: crypto.randomUUID(),
    fingerprint: await fingerprint(selected.projection, context.signal),
    modelVersion: 'FSRS-6',
    deckId: context.deckId,
    baselineModelId: selected.effective,
    baselineSelectionId: selected.selection,
    weights: selected.weights,
    retention: selected.projection.retention,
    maximumInterval: selected.projection.maximumInterval,
    enableShortTerm: selected.projection.enableShortTerm,
    dayStartHour: selected.projection.dayStartHour,
    cutoff: new Date(cutoff).toISOString(),
    createdAt: (context.now ?? new Date()).toISOString(),
    counts: {
      reviews: included,
      cards: new Set(histories.map((history) => history.cardId)).size,
      training,
      validation,
      excluded,
    },
    histories,
  }
  // The host stores its own copy too; freeze here catches accidental local edits.
  for (const history of histories) {
    Object.freeze(history.ratings)
    Object.freeze(history.elapsedDays)
    Object.freeze(history.reviewedAt)
    Object.freeze(history)
  }
  Object.freeze(histories)
  Object.freeze(snapshot.weights)
  Object.freeze(snapshot.counts)
  return Object.freeze(snapshot)
}

// FSRS-rs 6.6 r_matrix_index: interval, long-term review count, prior lapses.
// Identical grouping on both models avoids choosing bins to favor a candidate.
const bin = (value: number, scale: number, base: number) =>
  Math.round(scale * base ** Math.floor(Math.log(value) / Math.log(base)))

async function evaluate(
  snapshot: StudyTrainingSnapshot,
  weights: number[],
  signal?: AbortSignal,
): Promise<StudyModelMetrics> {
  const algorithm = new FSRSAlgorithm({
    w: weights,
    enable_short_term: snapshot.enableShortTerm,
    enable_fuzz: false,
    request_retention: snapshot.retention,
    maximum_interval: snapshot.maximumInterval,
  })
  const groups = new Map<string, { predicted: number; actual: number; count: number }>()
  const cutoff = Date.parse(snapshot.cutoff)
  let count = 0,
    loss = 0,
    processed = 0
  for (const history of snapshot.histories) {
    let memory: FSRSState | null = null,
      longTerm = 0,
      lapses = 0
    for (let index = 0; index < history.ratings.length; index++) {
      if (++processed % 512 === 0) {
        await yieldTurn()
        abort(signal)
      }
      const elapsed = history.elapsedDays[index]!,
        rating = history.ratings[index]!
      if (index > 0 && elapsed > 0) longTerm++
      if (memory && elapsed > 0 && Date.parse(history.reviewedAt[index]!) >= cutoff) {
        const predicted = Math.min(
          1 - 1e-7,
          Math.max(1e-7, algorithm.forgetting_curve(elapsed, memory.stability)),
        )
        if (!Number.isFinite(predicted)) throw new Error('invalid-fsrs-weights')
        const actual = rating === 1 ? 0 : 1
        loss -= actual * Math.log(predicted) + (1 - actual) * Math.log(1 - predicted)
        const key = `${bin(elapsed, 248, 3.62)}:${bin(longTerm + 1, 1.99, 1.89)}:${lapses ? bin(lapses, 1.65, 1.73) : 0}`
        const group = groups.get(key) ?? { predicted: 0, actual: 0, count: 0 }
        group.predicted += predicted
        group.actual += actual
        group.count++
        groups.set(key, group)
        count++
      }
      memory = algorithm.next_state(memory, elapsed, rating)
      if (!Number.isFinite(memory.stability) || !Number.isFinite(memory.difficulty))
        throw new Error('invalid-fsrs-weights')
      if (index > 0 && elapsed > 0 && rating === 1) lapses++
    }
  }
  abort(signal)
  if (count < 128 || count !== snapshot.counts.validation)
    throw new Error('insufficient-training-history')
  const squared = [...groups.values()].reduce(
    (sum, group) => sum + ((group.predicted - group.actual) / group.count) ** 2 * group.count,
    0,
  )
  return { logLoss: loss / count, rmse: Math.sqrt(squared / count) }
}

/** Independent ts-fsrs replay; a plugin can propose weights, never its own score. */
export async function evaluateCandidate(
  snapshot: StudyTrainingSnapshot,
  weights: readonly number[],
  signal?: AbortSignal,
) {
  abort(signal)
  if (snapshot.modelVersion !== 'FSRS-6') throw new Error('unsupported-model')
  if (
    snapshot.counts.reviews < 1024 ||
    snapshot.counts.training < 512 ||
    snapshot.counts.validation < 128
  )
    throw new Error('insufficient-training-history')
  const candidateWeights = validateTrainingWeights(weights, snapshot.enableShortTerm)
  const baselineWeights = validateTrainingWeights(snapshot.weights, snapshot.enableShortTerm)
  const baseline = await evaluate(snapshot, baselineWeights, signal)
  const candidate = await evaluate(snapshot, candidateWeights, signal)
  if (!(baseline.logLoss - candidate.logLoss > 1e-6 && baseline.rmse - candidate.rmse > 1e-6))
    throw new Error('candidate-not-improved')
  return { baseline, candidate }
}
