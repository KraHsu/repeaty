/** The host supplies immutable, chronologically ordered history segments. */
export interface TrainingHistory {
  cardId: string
  ratings: readonly number[]
  elapsedDays: readonly number[]
  reviewedAt: readonly string[]
}
export interface TrainingInput {
  modelVersion: 'FSRS-6'
  enableShortTerm: boolean
  cutoff: string
  histories: readonly TrainingHistory[]
}
export const TRAINING_ENGINE = '@open-spaced-repetition/binding-wasm32-wasip1@0.6.0'
export const TRAINING_LIMITS = Object.freeze({
  histories: 20_000,
  reviews: 100_000,
  items: 50_000,
  prefixReviews: 2_000_000,
  historyReviews: 1024,
})
export type TrainingBinding = Pick<
  typeof import('@open-spaced-repetition/binding-wasm32-wasip1'),
  'FSRSBindingReview' | 'FSRSBindingItem' | 'computeParameters'
>

/** Keep the entire pre-cutoff prefix: trimming the first review invents a new card. */
export function trainingPrefixes(input: TrainingInput) {
  if (input.modelVersion !== 'FSRS-6') throw new Error('unsupported-model')
  const cutoff = Date.parse(input.cutoff)
  if (!Number.isFinite(cutoff) || input.histories.length > TRAINING_LIMITS.histories)
    throw new Error('invalid-training-history')
  let reviewCount = 0,
    prefixReviews = 0
  const items: { ratings: readonly number[]; elapsedDays: readonly number[] }[] = []
  for (const history of input.histories) {
    const size = history.ratings.length
    if (
      !size ||
      size !== history.elapsedDays.length ||
      size !== history.reviewedAt.length ||
      history.elapsedDays[0] !== 0 ||
      size > TRAINING_LIMITS.historyReviews
    )
      throw new Error('invalid-training-history')
    reviewCount += size
    if (reviewCount > TRAINING_LIMITS.reviews) throw new Error('training-limit')
    let lastTime = -Infinity
    for (let index = 0; index < size; index++) {
      const time = Date.parse(history.reviewedAt[index]!),
        rating = history.ratings[index]!,
        delta = history.elapsedDays[index]!
      if (
        !Number.isFinite(time) ||
        time < lastTime ||
        !Number.isInteger(rating) ||
        rating < 1 ||
        rating > 4 ||
        !Number.isInteger(delta) ||
        delta < 0 ||
        delta > 36_500
      )
        throw new Error('invalid-training-history')
      lastTime = time
      if (index === 0 || time >= cutoff || delta === 0) continue
      prefixReviews += index + 1
      if (prefixReviews > TRAINING_LIMITS.prefixReviews || items.length >= TRAINING_LIMITS.items)
        throw new Error('training-limit')
      items.push({
        ratings: history.ratings.slice(0, index + 1),
        elapsedDays: history.elapsedDays.slice(0, index + 1),
      })
    }
  }
  if (items.length < 512) throw new Error('insufficient-training-history')
  return items
}

export async function train(
  binding: TrainingBinding,
  input: TrainingInput,
  progress: (current: number, total: number) => void,
) {
  const prefixes = trainingPrefixes(input)
  const items = prefixes.map(
    ({ ratings, elapsedDays }) =>
      new binding.FSRSBindingItem(
        ratings.map((rating, index) => new binding.FSRSBindingReview(rating, elapsedDays[index]!)),
      ),
  )
  const weights = await binding.computeParameters(items, {
    modelVersion: 'FSRS-6',
    enableShortTerm: input.enableShortTerm,
    numRelearningSteps: 1,
    trainingConfig: {
      numEpochs: 5,
      batchSize: 512,
      seed: 2026,
      maxSeqLen: TRAINING_LIMITS.historyReviews,
      learningRate: 0.04,
      gamma: 1,
    },
    progress,
  })
  if (weights.length !== 21 || weights.some((weight) => !Number.isFinite(weight)))
    throw new Error('invalid-trained-parameters')
  return { weights, engine: TRAINING_ENGINE }
}
