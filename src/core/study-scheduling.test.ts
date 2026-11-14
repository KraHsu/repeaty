import { afterEach, expect, it, vi } from 'vitest'
import { fsrs, generatorParameters } from 'ts-fsrs'
import { fixture, input, now } from './test-fixtures'
import { hydrateSchedule, saveNote, type Library } from './model'
import { studySettings, studySettingsSchema, effectiveFsrsWeights } from './study-settings'
import { fsrsModelSchema } from './study-data'
import { searchCards, studyCards } from './search'
import { deckStudyCounts } from './deck-status'
import {
  available,
  changeCards,
  dailyUsage,
  dueCards,
  previewReview,
  reviewCard,
  undoReview,
} from './scheduler'
import { studyDay, nextStudyDayStart } from './study-day'
import { arrangeSource, nextReadingInterval } from './source-queue'
import { adaptiveReadingPlan } from './adaptive-reading'
import { readingUndoFor, undoReading } from './reading-operations'
import { finishMixedCard, finishMixedReading, nextMixedTask, startMixedRound } from './mixed-study'
import type { Source } from './source-data'

afterEach(() => vi.unstubAllEnvs())
const reading = (id: string): Source => ({
  id,
  title: id,
  url: '',
  mediaId: `media-${id}`,
  characters: 1,
  format: 'plain',
  createdAt: now.toISOString(),
})
it('keeps default FSRS previews and stored results unchanged', () => {
  const library = fixture()
  const raw = fsrs({ request_retention: 0.9, enable_fuzz: false }).repeat(
    hydrateSchedule(library.cards[0]!.schedule),
    now,
  )
  expect(studySettings(library)).toMatchObject({
    dayStartHour: 0,
    enableShortTerm: true,
    maxIntervalDays: 36500,
    priorityMode: 'legacy',
    readingMode: 'legacy',
  })
  for (const rating of [1, 2, 3, 4] as const) {
    const preview = previewReview(library.cards[0]!, now, library.decks[0], library)
    expect(preview[rating].card).toEqual(raw[rating].card)
    expect(reviewCard(library, library.cards[0]!.id, rating, now).cards[0]!.schedule.due).toBe(
      raw[rating].card.due.toISOString(),
    )
  }
})
it.each(['UTC', 'Asia/Shanghai', 'America/New_York'])(
  'records immutable study days and applies actual boundary windows for usage and burial in %s',
  (zone) => {
    vi.stubEnv('TZ', zone)
    const at = new Date(2026, 10, 1, 3, 30)
    let library = saveNote(fixture(), { ...input, front: 'Second' }, undefined, false, now)
    library.studySettings = [studySettingsSchema.parse({ dayStartHour: 4 })]
    library.decks[0]!.newLimit = 1
    const first = dueCards(library, at)[0]!
    library = reviewCard(library, first.id, 3, at)
    expect(library.reviews[0]!.studyDay).toBe('2026-10-31')
    expect(dailyUsage(library, new Date(2026, 10, 1, 3, 59)).get('deck')!.new.size).toBe(1)
    expect(dailyUsage(library, new Date(2026, 10, 1, 4)).get('deck')!.new.size).toBe(0)
    const searchBuried = changeCards(library, new Set([library.cards[1]!.id]), 'bury', at)
    expect(
      searchCards(searchBuried, { query: 'is:buried', state: 'all', deckId: '' }, at).map(
        (card) => card.id,
      ),
    ).toEqual([library.cards[1]!.id])
    expect(studyCards(searchBuried, [library.cards[1]!.id], [], at)).toHaveLength(0)
    expect(deckStudyCounts(searchBuried, at).get('deck')!.buried).toBe(1)
    expect(
      searchCards(
        searchBuried,
        { query: 'is:buried', state: 'all', deckId: '' },
        new Date(2026, 10, 1, 4),
      ),
    ).toHaveLength(0)
    const history = structuredClone(library.reviews)
    library.studySettings[0]!.dayStartHour = 0
    expect(dailyUsage(library, at).get('deck')!.new.size).toBe(1)
    expect(library.reviews).toEqual(history)
    expect(undoReview(library).reviews).toEqual([])
    library.studySettings[0]!.dayStartHour = 4
    const second = library.cards.find((card) => card.id !== first.id)!
    const buried = changeCards(library, new Set([second.id]), 'bury', at)
    expect(
      available(
        buried.cards.find((card) => card.id === second.id)!,
        at,
        studySettings(buried),
      ),
    ).toBe(false)
    expect(
      available(
        buried.cards.find((card) => card.id === second.id)!,
        nextStudyDayStart(at, studySettings(buried)),
        studySettings(buried),
      ),
    ).toBe(true)
  },
)
it('uses the same bounded model and day-boundary rules in preview and commit, with deck overrides', () => {
  const library = fixture()
  library.studySettings = [
    studySettingsSchema.parse({
      dayStartHour: 4,
      maxIntervalDays: 1,
      enableShortTerm: false,
      activeFsrsModelId: 'global',
    }),
  ]
  const weights = [...generatorParameters().w]
  weights[3] = weights[3]! / 2
  const model = (id: string, deckId?: string): Library['fsrsModels'][number] =>
    fsrsModelSchema.parse({
      id,
      deckId,
      createdAt: now.toISOString(),
      modelVersion: 'FSRS-6',
      weights,
      baselineWeights: [...generatorParameters().w],
      historyFingerprint: '0'.repeat(64),
      counts: { reviews: 1024, cards: 200, training: 800, validation: 224, excluded: 0 },
      metrics: { baseline: { logLoss: 0.7, rmse: 0.4 }, candidate: { logLoss: 0.6, rmse: 0.3 } },
      engine: 'test',
    })
  library.fsrsModels = [model('global'), model('deck-model', 'deck')]
  library.decks[0]!.activeFsrsModelId = 'deck-model'
  expect(effectiveFsrsWeights(library, 'deck')).toEqual(weights)
  library.fsrsModels[1]!.deckId = 'other'
  expect(effectiveFsrsWeights(library, 'deck')).toBeUndefined()
  library.fsrsModels[1]!.deckId = 'deck'
  const card = library.cards[0]!
  const before = structuredClone(card.schedule)
  for (const rating of [1, 2, 3, 4] as const) {
    const preview = previewReview(card, now, library.decks[0], library)
    expect(preview[rating].card.scheduled_days).toBeLessThanOrEqual(1)
    const updated = reviewCard(library, card.id, rating, now)
    expect(updated.cards[0]!.schedule.due).toBe(preview[rating].card.due.toISOString())
    expect(updated.reviews[0]!.previous!.schedule).toEqual(before)
    expect(undoReview(updated)).toEqual(library)
  }
})
it('applies explicit reading ranges and counts only confirmed reads, including undo', () => {
  let library = fixture()
  library.studySettings = [
    studySettingsSchema.parse({
      dayStartHour: 4,
      readingMode: 'configured',
      readingInitialDays: 7,
      readingGrowthMin: 2,
      readingGrowthMax: 2,
      readingMaxDays: 20,
    }),
  ]
  library.sources = [reading('one'), reading('two')]
  const first = library.sources[0]!
  const plan = nextReadingInterval(first, now, library)
  expect(plan.intervalDays).toBe(7)
  const changed = arrangeSource(library, first.id, first.mediaId, { type: 'read', ...plan }, now)
  expect(changed.studyEvents).toMatchObject([
    { kind: 'reading', sourceId: 'one', studyDay: studyDay(now, studySettings(library)) },
  ])
  expect(nextReadingInterval(changed.sources[0]!, now, changed).intervalDays).toBe(14)
  expect(() =>
    arrangeSource(changed, first.id, first.mediaId, { type: 'read', ...plan }, now),
  ).toThrow()
  const undo = readingUndoFor(library, changed, 'scope')!
  const second = changed.sources[1]!
  const adaptive = adaptiveReadingPlan(second, 'good', now, studySettings(changed))
  expect(adaptive.intervalDays).toBe(7)
  const another = arrangeSource(
    changed,
    second.id,
    second.mediaId,
    { type: 'read-adaptive', feedback: 'good', ...adaptive },
    now,
  )
  expect(another.studyEvents).toHaveLength(2)
  expect(undoReading(another, undo).studyEvents.map((event) => event.sourceId)).toEqual(['two'])
  const deferred = arrangeSource(
    library,
    first.id,
    first.mediaId,
    { type: 'defer', date: '2027-01-01' },
    now,
  )
  expect(deferred.studyEvents).toEqual([])
  const grown = { ...first, readingIntervalDays: 14 }
  expect(nextReadingInterval(grown, now, library).intervalDays).toBe(20)
})
it('mixes multiple readings per cycle and keeps absolute priority inside ordinary availability rules', () => {
  let library = fixture()
  library.decks[0]!.burySiblings = false
  for (let index = 1; index < 4; index++)
    library = saveNote(library, { ...input, front: `Q${index}` }, undefined, false, now)
  library.sources = ['a', 'b', 'c', 'd'].map(reading)
  library.studySettings = [studySettingsSchema.parse({ cardsPerReading: 2, readingsPerCycle: 2 })]
  let round = startMixedRound(library, now)
  const order = []
  for (let index = 0; index < 8; index++) {
    const next = nextMixedTask(round, library, now)!
    order.push(next.kind)
    if (next.kind === 'card') {
      library = reviewCard(library, next.id, 3, now)
      round = finishMixedCard(round)
    } else round = finishMixedReading(round, next.index)
  }
  expect(order).toEqual([
    'card',
    'card',
    'reading',
    'reading',
    'card',
    'card',
    'reading',
    'reading',
  ])
  const absolute = fixture()
  absolute.studySettings = [studySettingsSchema.parse({ priorityMode: 'weighted' })]
  absolute.sources = [{ ...reading('first'), studyPriority: 0 }]
  expect(nextMixedTask(startMixedRound(absolute, now), absolute, now)?.kind).toBe('reading')
  absolute.sources[0]!.queue = { state: 'active', availableOn: '2099-01-01' }
  expect(nextMixedTask(startMixedRound(absolute, now), absolute, now)?.kind).toBe('card')
})
it('rejects contradictory or unbounded scheduling settings', () => {
  for (const patch of [
    { dayStartHour: 24 },
    { maxIntervalDays: 0 },
    { readingsPerCycle: 0 },
    { priorityRatio: 101 },
    { readingGrowthMin: 3, readingGrowthMax: 2 },
    { readingInitialDays: 400, readingMaxDays: 365 },
    { newCardWindowDays: 100 },
  ])
    expect(studySettingsSchema.safeParse(patch).success).toBe(false)
})
