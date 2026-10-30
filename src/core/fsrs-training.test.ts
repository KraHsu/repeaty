import { afterEach, describe, expect, it, vi } from 'vitest'
import { createEmptyCard, default_w, fsrs, State } from 'ts-fsrs'
import { serializeSchedule } from './model'
import { fixture } from './test-fixtures'
import { studySettingsSchema } from './study-settings'
import { fsrsModelSchema } from './study-data'
import {
  evaluateCandidate,
  trainingFingerprint,
  trainingSnapshot,
  validateTrainingWeights,
} from './fsrs-training'

// Produced by the real 0.6.0 threadless WASM worker from the same synthetic
// histories; its successful browser run is recorded in the ignored P6 evidence.
const learned = [
  2.96983003616333, 2.969830274581909, 2.96983003616333, 2.969829797744751, 6.621634006500244,
  0.627612292766571, 2.8517472743988037, 0.0010000000474974513, 1.664921522140503,
  0.3540651500225067, 0.5826438069343567, 1.66945219039917, 0.0010000000474974513,
  0.4476695954799652, 1.806841492652893, 0.4412839412689209, 1.8729000091552734, 0.5425000190734863,
  0.09120000153779984, 0.0658000037074089, 0.10000000149011612,
]
const scope = { workspaceScope: 'library-a', now: new Date('2025-03-10T00:00:00Z') }

function historyLibrary() {
  const library = fixture(),
    note = library.notes[0]!,
    card = library.cards[0]!
  library.notes = []
  library.cards = []
  library.reviews = []
  const scheduler = fsrs({ enable_fuzz: false })
  for (let index = 0; index < 160; index++) {
    const id = `card-${index}`,
      noteId = `note-${index}`
    let schedule = createEmptyCard(new Date('2025-01-01T12:00:00Z'))
    library.notes.push({ ...note, id: noteId })
    for (let step = 0; step < 9; step++) {
      const time = new Date(Date.UTC(2025, 0, 1 + step * 7, 12)),
        rating = (index + step) % 7 === 0 ? 1 : (index + step) % 11 === 0 ? 2 : 3
      const result = scheduler.next(schedule, time, rating)
      library.reviews.push({
        id: `review-${index}-${step}`,
        cardId: id,
        rating,
        reviewedAt: time.toISOString(),
        nextDue: result.card.due.toISOString(),
        studyDay: time.toISOString().slice(0, 10),
        kind:
          schedule.state === State.New
            ? 'new'
            : schedule.state === State.Review
              ? 'review'
              : 'learning',
        source: 'normal',
        previous: { schedule: serializeSchedule(schedule), updatedAt: time.toISOString() },
      })
      schedule = result.card
    }
    library.cards.push({ ...card, id, noteId, schedule: serializeSchedule(schedule) })
  }
  return library
}
afterEach(() => vi.unstubAllEnvs())

describe('training snapshots', () => {
  it('owns and freezes a chronological split without rewriting library data', async () => {
    const library = historyLibrary(),
      before = JSON.stringify(library)
    const snapshot = await trainingSnapshot(library, scope)
    expect(snapshot).toMatchObject({
      modelVersion: 'FSRS-6',
      cutoff: '2025-02-19T12:00:00.000Z',
      counts: { reviews: 1440, cards: 160, training: 960, validation: 320, excluded: 0 },
    })
    expect(snapshot.histories[0]!.elapsedDays).toEqual([0, 7, 7, 7, 7, 7, 7, 7, 7])
    expect(snapshot.weights).toEqual(default_w)
    expect(snapshot.fingerprint).toMatch(/^[a-f0-9]{64}$/)
    expect(snapshot.fingerprint).toBe(await trainingFingerprint(library))
    expect(Object.isFrozen(snapshot.histories[0]!.ratings)).toBe(true)
    expect(JSON.stringify(library)).toBe(before)
    library.reviews[0]!.rating = 4
    expect(snapshot.histories[0]!.ratings[0]).toBe(1)
  })
  it('excludes partial legacy histories despite migration labeling their first row new', async () => {
    const library = historyLibrary()
    for (const review of library.reviews.filter((row) => row.cardId === 'card-0'))
      delete review.previous
    const snapshot = await trainingSnapshot(library, scope)
    expect(snapshot.counts).toMatchObject({ excluded: 9, reviews: 1431, cards: 159 })
    expect(snapshot.histories.some((history) => history.cardId === 'card-0')).toBe(false)
  })
  it('stops at deleted or discontinuous records and resumes only at a reliable reset', async () => {
    const library = historyLibrary()
    library.reviews = library.reviews.filter((row) => row.id !== 'review-0-3')
    const snapshot = await trainingSnapshot(library, scope)
    expect(snapshot.histories.find((history) => history.cardId === 'card-0')!.ratings).toHaveLength(
      3,
    )
    expect(snapshot.counts.excluded).toBe(5)
    const reset = library.reviews.find((row) => row.id === 'review-0-7')!
    reset.previous!.schedule = serializeSchedule(createEmptyCard(new Date(reset.reviewedAt)))
    reset.kind = 'new'
    const next = library.reviews.find((row) => row.id === 'review-0-8')!
    next.previous!.schedule.reps = 1
    const resumed = await trainingSnapshot(library, scope)
    expect(
      resumed.histories
        .filter((history) => history.cardId === 'card-0')
        .map((history) => history.ratings.length),
    ).toEqual([3, 2])
    expect(resumed.counts.excluded).toBe(3)
  })
  it.each(['UTC', 'Asia/Shanghai', 'America/New_York'])(
    'uses scheduler UTC gaps even across DST / local boundary in %s',
    async (zone) => {
      vi.stubEnv('TZ', zone)
      const library = historyLibrary()
      library.studySettings = [studySettingsSchema.parse({ dayStartHour: 4 })]
      const first = library.reviews.find((row) => row.id === 'review-0-0')!,
        second = library.reviews.find((row) => row.id === 'review-0-1')!,
        third = library.reviews.find((row) => row.id === 'review-0-2')!
      first.reviewedAt = '2024-11-03T03:59:00.000Z'
      second.reviewedAt = '2024-11-03T08:00:00.000Z'
      second.previous!.schedule.last_review = first.reviewedAt
      third.previous!.schedule.last_review = second.reviewedAt
      const snapshot = await trainingSnapshot(library, scope)
      expect(
        snapshot.histories.find((history) => history.cardId === 'card-0')!.elapsedDays.slice(0, 2),
      ).toEqual([0, 0])
    },
  )
  it('requires enough total, training, and held-out observations independently', async () => {
    const library = historyLibrary()
    library.reviews = library.reviews.slice(0, 1000)
    await expect(trainingSnapshot(library, scope)).rejects.toThrow('insufficient-training-history')
    const sameDay = historyLibrary()
    for (const review of sameDay.reviews) {
      const step = Number(review.id.split('-').at(-1))
      review.reviewedAt = new Date(Date.UTC(2025, 0, 1, 12, step)).toISOString()
      if (step)
        review.previous!.schedule.last_review = new Date(
          Date.UTC(2025, 0, 1, 12, step - 1),
        ).toISOString()
    }
    await expect(trainingSnapshot(sameDay, scope)).rejects.toThrow('insufficient-training-history')
  })
  it('fingerprints training inputs without expiring on unrelated edits/statistic flushes', async () => {
    const library = historyLibrary(),
      fingerprint = await trainingFingerprint(library)
    library.notes[0]!.front = 'changed text'
    library.cards[0]!.schedule.due = '2030-01-01T00:00:00.000Z'
    library.studySettings = [
      studySettingsSchema.parse({
        statisticsSince: '2026-01-01T00:00:00.000Z',
        defaultPriority: 9,
      }),
    ]
    library.studyActivity.push({
      id: 'active',
      kind: 'other',
      studyDay: '2026-01-01',
      startedAt: '2026-01-01T00:00:00.000Z',
      endedAt: '2026-01-01T00:01:00.000Z',
      activeMs: 60_000,
    })
    expect(await trainingFingerprint(library)).toBe(fingerprint)
    library.reviews[0]!.rating = 4
    expect(await trainingFingerprint(library)).not.toBe(fingerprint)
    library.reviews[0]!.rating = 1
    library.studySettings[0]!.dayStartHour = 4
    expect(await trainingFingerprint(library)).not.toBe(fingerprint)
  })
  it('excludes deck overrides globally and remembers explicit versus inherited baseline selection', async () => {
    const library = historyLibrary(),
      initial = await trainingSnapshot(library, scope)
    library.decks.push({ ...library.decks[0]!, id: 'other', activeFsrsModelId: 'other-model' })
    library.notes[0]!.deckId = 'other'
    library.fsrsModels.push(
      fsrsModelSchema.parse({
        id: 'global-model',
        createdAt: scope.now.toISOString(),
        modelVersion: 'FSRS-6',
        weights: learned,
        baselineWeights: [...default_w],
        historyFingerprint: initial.fingerprint,
        counts: initial.counts,
        metrics: { baseline: { logLoss: 1, rmse: 0.5 }, candidate: { logLoss: 0.8, rmse: 0.4 } },
        engine: 'test',
      }),
    )
    library.studySettings = [studySettingsSchema.parse({ activeFsrsModelId: 'global-model' })]
    const global = await trainingSnapshot(library, scope)
    expect(global.counts.reviews).toBe(1431)
    expect(global.histories.some((history) => history.cardId === 'card-0')).toBe(false)
    const inherited = await trainingSnapshot(library, { ...scope, deckId: 'deck' })
    expect(inherited.baselineModelId).toBe('global-model')
    expect(inherited.baselineSelectionId).toBeUndefined()
    expect(inherited.weights).toEqual(learned)
    await expect(trainingSnapshot(library, { ...scope, deckId: 'missing' })).rejects.toThrow(
      'missing-deck',
    )
  })
})

describe('independent host validation', () => {
  it('scores actual held-out history with ts-fsrs and requires both improvements', async () => {
    const library = historyLibrary(),
      snapshot = await trainingSnapshot(library, scope)
    const metrics = await evaluateCandidate(snapshot, learned)
    expect(metrics.candidate.logLoss).toBeLessThan(metrics.baseline.logLoss - 1e-6)
    expect(metrics.candidate.rmse).toBeLessThan(metrics.baseline.rmse - 1e-6)
    // Independently verify log loss with full scheduler records instead of the
    // evaluator's memory-only replay. No plugin-provided score participates.
    const scheduler = fsrs({ enable_fuzz: false }),
      cutoff = Date.parse(snapshot.cutoff)
    let loss = 0,
      count = 0
    for (const history of snapshot.histories) {
      let card = createEmptyCard(new Date(history.reviewedAt[0]!))
      for (let index = 0; index < history.ratings.length; index++) {
        const time = new Date(history.reviewedAt[index]!),
          rating = history.ratings[index]!
        if (index && time.getTime() >= cutoff && history.elapsedDays[index]! > 0) {
          const predicted = Math.max(
            1e-7,
            Math.min(1 - 1e-7, scheduler.get_retrievability(card, time, false)),
          )
          loss -= rating === 1 ? Math.log(1 - predicted) : Math.log(predicted)
          count++
        }
        card = scheduler.next(card, time, rating).card
      }
    }
    expect(count).toBe(snapshot.counts.validation)
    expect(metrics.baseline.logLoss).toBeCloseTo(loss / count, 10)
    await expect(evaluateCandidate(snapshot, default_w)).rejects.toThrow('candidate-not-improved')
  })
  it('rejects wrong dimensions, non-finite values and out-of-bounds weights instead of silently clipping', () => {
    for (const weights of [
      default_w.slice(0, 19),
      [...default_w, 0, 0],
      default_w.map((x, i) => (i === 1 ? NaN : x)),
      default_w.map((x, i) => (i === 20 ? -0.1 : x)),
      default_w.map((x, i) => (i === 8 ? 90 : x)),
    ])
      expect(() => validateTrainingWeights(weights)).toThrow('invalid-fsrs-weights')
    expect(validateTrainingWeights(learned)).toEqual(learned)
  })
  it('cancels snapshot or cooperative host evaluation without writing library state', async () => {
    const library = historyLibrary(),
      before = JSON.stringify(library),
      controller = new AbortController()
    controller.abort()
    await expect(
      trainingSnapshot(library, { ...scope, signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' })
    const snapshot = await trainingSnapshot(library, scope),
      running = new AbortController()
    const pending = evaluateCandidate(snapshot, learned, running.signal)
    running.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(JSON.stringify(library)).toBe(before)
  })
  it('does not accept a caller-inflated sample count', async () => {
    const snapshot = await trainingSnapshot(historyLibrary(), scope)
    await expect(
      evaluateCandidate({ ...snapshot, counts: { ...snapshot.counts, validation: 999 } }, learned),
    ).rejects.toThrow('insufficient-training-history')
  })
})
