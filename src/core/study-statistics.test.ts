import { afterEach, expect, it, vi } from 'vitest'
import { fixture } from './test-fixtures'
import { studyStatistics, studyStatisticsDetails } from './study-statistics'
import { studySettingsSchema } from './study-settings'
import { prepareSource } from './sources'
import { practiceSchema } from './practice-data'
import type { Library } from './model'
import type { Source } from './source-data'
import { sourceQueueState } from './source-queue'

afterEach(() => vi.unstubAllEnvs())

const at = new Date('2026-10-30T12:00:00.000Z')
function context(now = at) {
  return { now, workspaceScope: 'local:statistics', revision: 12 }
}
function sample() {
  const library = fixture()
  library.studySettings = [
    studySettingsSchema.parse({ statisticsSince: '2026-10-20T12:00:00.000Z' }),
  ]
  const source = prepareSource(
    { title: 'Reading about memory', content: 'Read this material.', format: 'plain', url: '' },
    at,
  ).source
  library.sources = [source]
  return { library, source, cardId: library.cards[0]!.id }
}
function reading(library: Library, id = 'reading-1', studyDay = '2026-10-28') {
  return {
    id,
    kind: 'reading' as const,
    studyDay,
    occurredAt: `${studyDay}T12:00:00.000Z`,
    sourceId: library.sources[0]!.id,
  }
}

it('keeps stored review days, separates pure practice, and never invents older reading coverage', () => {
  vi.stubEnv('TZ', 'UTC')
  const { library, cardId } = sample()
  library.studySettings[0]!.dayStartHour = 4
  library.reviews = [
    {
      id: 'rating-1',
      cardId,
      rating: 3,
      reviewedAt: '2026-10-28T02:00:00.000Z',
      studyDay: '2026-10-28',
      nextDue: '2026-11-01T12:00:00.000Z',
      kind: 'review',
      source: 'normal',
    },
  ]
  library.studyEvents = [
    reading(library),
    {
      id: 'ordinary-practice',
      kind: 'practice',
      studyDay: '2026-10-28',
      occurredAt: '2026-10-28T12:00:00.000Z',
      cardId,
    },
  ]
  const practice = practiceSchema.parse({
    id: 'plugin-practice',
    cardId,
    contentRevision: 'revision',
    startedAt: '2026-10-28T12:00:00.000Z',
    completedAt: '2026-10-28T02:10:00.000Z',
    studyDay: '2026-10-28',
    completion: 'practice',
    question: {
      front: 'Question',
      back: '',
      format: 'plain',
      plugin: { id: 'typed-answer', version: 1, data: {} },
    },
  })
  library.practices = [practice, { ...practice, id: 'formal-completion', completion: 'review' }]
  const result = studyStatistics(library, { from: '2026-10-19', to: '2026-10-31' }, context())
  expect(result.days.find((day) => day.day === '2026-10-19')).toMatchObject({
    reviews: 0,
    readings: null,
    practices: null,
    foregroundMs: null,
  })
  expect(result.days.find((day) => day.day === '2026-10-28')).toMatchObject({
    reviews: 1,
    readings: 1,
    practices: 2,
  })
  expect(result.days.find((day) => day.day === '2026-10-27')!.reviews).toBe(0)
  expect(result.days.at(-1)).toMatchObject({ readings: null, foregroundMs: null })
  expect(result).toMatchObject({
    workspaceScope: 'local:statistics',
    revision: 12,
    dayStartHour: 4,
  })
})

it('counts event identity once, follows undone records, and never reads submission bodies', () => {
  const { library } = sample()
  const event = reading(library)
  library.studyEvents = [event, { ...event }]
  Object.defineProperty(library, 'attempts', {
    get: () => {
      throw new Error('must not read code bodies')
    },
  })
  const query = { from: '2026-10-28', to: '2026-10-28' }
  expect(studyStatistics(library, query, context()).days[0]!.readings).toBe(1)
  library.studyEvents = []
  expect(studyStatistics(library, query, context()).days[0]!.readings).toBe(0)
})

it('shows current saved plans, includes future buried cards, and excludes unavailable material', () => {
  vi.stubEnv('TZ', 'UTC')
  const { library, source } = sample()
  library.decks[0]!.newLimit = 0 // Planned quantities are not a daily quota estimate.
  const card = library.cards[0]!
  library.cards = [
    { ...card, id: 'overdue', schedule: { ...card.schedule, due: '2026-10-20T00:00:00.000Z' } },
    { ...card, id: 'suspended', suspended: true },
    { ...card, id: 'buried-now', buriedOn: '2026-10-30' },
    {
      ...card,
      id: 'buried-future',
      buriedOn: '2026-10-30',
      schedule: { ...card.schedule, due: '2026-11-02T04:00:00.000Z' },
    },
    { ...card, id: 'missing-plugin' },
  ]
  const root: Source = {
    ...source,
    id: 'book',
    document: {
      schemaVersion: 1,
      format: 'epub',
      providerId: 'document-reader',
      readerId: 'documents',
      originalMediaId: 'book',
      container: true,
    },
  }
  library.sources = [
    { ...source, id: 'overdue-reading', queue: { state: 'active', availableOn: '2026-10-20' } },
    { ...source, id: 'future-reading', queue: { state: 'active', availableOn: '2026-11-02' } },
    { ...source, id: 'archived', queue: { state: 'archived', availableOn: '2026-11-02' } },
    {
      ...source,
      id: 'inbox',
      inbox: { state: 'new', kind: 'text', capturedAt: at.toISOString() },
    },
    root,
    {
      ...source,
      id: 'chapter1',
      studySequence: { groupId: 'book', index: 0, mode: 'sequential', completed: false },
    },
    {
      ...source,
      id: 'chapter2',
      studySequence: { groupId: 'book', index: 1, mode: 'sequential', completed: false },
    },
    {
      ...source,
      id: 'completed',
      studySequence: { groupId: 'other', index: 0, mode: 'free', completed: true },
    },
  ]
  const options = {
    ...context(),
    canReview: (view: { id: string }) => view.id !== 'missing-plugin',
  }
  const result = studyStatistics(library, { from: '2026-10-29', to: '2026-11-03' }, options)
  expect(result.days.find((day) => day.day === '2026-10-29')).toMatchObject({
    scheduledCards: 0,
    scheduledReadings: 0,
  })
  expect(result.days.find((day) => day.day === '2026-10-30')).toMatchObject({
    scheduledCards: 1,
    scheduledReadings: 2,
  })
  expect(result.days.find((day) => day.day === '2026-11-02')).toMatchObject({
    scheduledCards: 1,
    scheduledReadings: 1,
  })
  expect(
    studyStatisticsDetails(
      library,
      { day: '2026-11-02', kind: 'scheduledCards' },
      options,
    ).items.map((entry) => entry.id),
  ).toEqual(['buried-future'])
})

it('uses cumulative foreground buckets once and separates mode totals from total active use', () => {
  const { library } = sample()
  const base = {
    studyDay: '2026-10-28',
    startedAt: '2026-10-28T12:00:00.000Z',
    endedAt: '2026-10-28T12:10:00.000Z',
  }
  library.studyActivity = [
    { ...base, id: 'read', kind: 'reading', activeMs: 60_000 },
    { ...base, id: 'read', kind: 'reading', activeMs: 120_000 },
    { ...base, id: 'review', kind: 'review', activeMs: 30_000 },
    { ...base, id: 'practice', kind: 'practice', activeMs: 90_000 },
    { ...base, id: 'other', kind: 'other', activeMs: 60_000 },
  ]
  expect(
    studyStatistics(library, { from: '2026-10-28', to: '2026-10-28' }, context()).days[0],
  ).toMatchObject({
    foregroundMs: 300_000,
    readingMs: 120_000,
    reviewMs: 30_000,
    practiceMs: 90_000,
  })
})

it.each(['UTC', 'Asia/Shanghai', 'America/New_York'])(
  'keeps every calendar day across DST and leap years in %s',
  (timezone) => {
    vi.stubEnv('TZ', timezone)
    const { library } = sample()
    const result = studyStatistics(
      library,
      { from: '2024-01-01', to: '2024-12-31' },
      context(new Date('2024-11-03T08:00:00.000Z')),
    )
    expect(result.days).toHaveLength(366)
    expect(new Set(result.days.map((day) => day.day)).size).toBe(366)
    expect(result.days.some((day) => day.day === '2024-02-29')).toBe(true)
    expect(result.days.filter((day) => day.day.startsWith('2024-11-'))).toHaveLength(30)
  },
)

it('bounds detail pages and rejects impossible dates or oversized ranges without mutating the library', () => {
  const { library } = sample()
  library.studyEvents = Array.from({ length: 207 }, (_, index) =>
    reading(library, String(index).padStart(3, '0')),
  )
  const before = JSON.stringify(library)
  const first = studyStatisticsDetails(
    library,
    { day: '2026-10-28', kind: 'readings', limit: 200 },
    context(),
  )
  const last = studyStatisticsDetails(
    library,
    { day: '2026-10-28', kind: 'readings', offset: first.nextOffset, limit: 200 },
    context(),
  )
  expect(first).toMatchObject({
    total: 207,
    nextOffset: 200,
    workspaceScope: 'local:statistics',
    revision: 12,
  })
  expect(first.items).toHaveLength(200)
  expect(last.items).toHaveLength(7)
  expect(new Set([...first.items, ...last.items].map((entry) => entry.id)).size).toBe(207)
  expect(last.nextOffset).toBeUndefined()
  expect(() =>
    studyStatistics(library, { from: '2026-02-30', to: '2026-03-03' }, context()),
  ).toThrow()
  expect(() =>
    studyStatistics(library, { from: '2024-01-01', to: '2025-01-01' }, context()),
  ).toThrow()
  expect(() =>
    studyStatisticsDetails(library, { day: '2026-10-28', kind: 'readings', limit: 201 }, context()),
  ).toThrow()
  expect(JSON.stringify(library)).toBe(before)
})

it('matches the real reading queue when a completed chapter is reopened', () => {
  vi.stubEnv('TZ', 'UTC')
  const { library, source } = sample()
  const chapter: Source = {
    ...source,
    queue: { state: 'active', availableOn: '2026-10-30' },
    studySequence: { groupId: 'book', index: 0, mode: 'free', completed: true },
  }
  library.sources = [chapter]
  const scheduled = () =>
    studyStatisticsDetails(
      library,
      {
        day: '2026-10-30',
        kind: 'scheduledReadings',
      },
      context(),
    ).items.map((item) => item.id)
  expect(sourceQueueState(chapter, '2026-10-30', library.sources)).toBe('archived')
  expect(scheduled()).toEqual([])
  library.sources = [{ ...chapter, studySequence: { ...chapter.studySequence!, completed: false } }]
  expect(sourceQueueState(library.sources[0]!, '2026-10-30', library.sources)).toBe('ready')
  expect(scheduled()).toEqual([source.id])
})
