import { expect, it } from 'vitest'
import { fixture, now } from './test-fixtures'
import { saveNote } from './model'
import { readLearning, type LearningQuery } from './learning-reader'
import { reviewCard, undoReview } from './scheduler'
import { practiceHistoryFixture } from '../../tests/fixtures/practice-history'

function read(
  library = fixture(),
  tool: LearningQuery['tool'] = 'repeaty_due_cards',
  args: Record<string, unknown> = {},
) {
  return readLearning(library, 7, { tool, arguments: args }, now)
}

it('uses the review queue, including limits, suspension, burial and plugin eligibility', () => {
  let library = fixture()
  for (let index = 0; index < 4; index++)
    library = saveNote(library, { ...library.notes[0]!, front: `Q${index}` }, undefined, false, now)
  library.cards[0]!.suspended = true
  library.cards[1]!.buriedOn = '2026-10-17'
  library.decks[0]!.newLimit = 1
  const result = read(library)
  expect(result).toMatchObject({ revision: 7, total: 1, offset: 0, nextOffset: null })
  expect('items' in result && result.items).toHaveLength(1)
  const blocked = readLearning(
    library,
    7,
    { tool: 'repeaty_due_cards', arguments: {} },
    now,
    () => false,
  )
  expect(blocked).toMatchObject({ total: 0, items: [] })
})

it('returns the displayed question for reverse and cloze cards without exposing answers or sources', () => {
  const reverse = fixture({ type: 'reversed', front: 'Forward Q', back: 'Reverse Q' })
  const result = read(reverse)
  expect('items' in result && result.items.map((entry) => entry.question).sort()).toEqual([
    'Forward Q',
    'Reverse Q',
  ])
  const library = fixture({
    type: 'cloze',
    front: 'Fill {{c1::secret::hint}}',
    back: 'extra-secret',
  })
  library.notes[0]!.excerpt = { sourceId: 'source', start: 0, end: 6, quote: 'secret' }
  const value = read(library)
  expect(value).toMatchObject({ items: [{ question: 'Fill [hint]' }] })
  expect(JSON.stringify(value)).not.toMatch(
    /secret|back|excerpt|sourceId|frontMedia|cloze.*answers/,
  )
})

it('paginates bounded results and rejects old revisions rather than mixing snapshots', () => {
  const library = fixture({ type: 'reversed' })
  const first = read(library, 'repeaty_due_cards', { limit: 1 })
  const second = read(library, 'repeaty_due_cards', { limit: 1, offset: 1, revision: 7 })
  expect(first).toMatchObject({ total: 2, nextOffset: 1 })
  expect(second).toMatchObject({ offset: 1, nextOffset: null })
  expect(() => read(library, 'repeaty_due_cards', { revision: 6 })).toThrow('library-changed')
  for (const args of [
    { limit: 51 },
    { offset: -1 },
    { offset: 0.5 },
    { limit: '20' },
    { includeAnswers: true },
    { path: '/etc/passwd' },
    { revision: Number.MAX_SAFE_INTEGER + 1 },
  ])
    expect(() => read(library, 'repeaty_due_cards', args)).toThrow('invalid-arguments')
  expect(() => read(library, 'write_library' as LearningQuery['tool'])).toThrow('unsupported-query')
})

it('returns practice summaries without reading bodies, answers, judge detail or arbitrary plugin data', () => {
  const library = practiceHistoryFixture(25)
  library.practices[0]!.question.back = 'private-answer'
  library.practices[0]!.question.plugin.data.secret = 'private-cookie'
  library.attempts[0]!.result!.detail = 'private-judge-detail'
  Object.defineProperty(library.attempts[0], 'code', {
    get() {
      throw new Error('Attempt body must not be read')
    },
  })
  const result = read(library, 'repeaty_practice_history')
  expect(result).toMatchObject({ total: 25, nextOffset: 20 })
  expect('items' in result && result.items[0]).toMatchObject({
    id: 'practice-24',
    attemptCount: 1,
    lastAttempt: { status: 'completed', result: { outcome: 'accepted' } },
  })
  const json = JSON.stringify(read(library, 'repeaty_practice_history', { offset: 20 }))
  expect(json).not.toMatch(/private-|"code"|"detail"|"data"|"back"/)
  const filtered = read(library, 'repeaty_practice_history', {
    cardId: library.cards[0]!.id,
    limit: 50,
  })
  expect(filtered).toMatchObject({ total: 13 })
})

it('keeps all projections read only and reports ratings after undo accurately', () => {
  const library = fixture()
  const reviewed = reviewCard(library, library.cards[0]!.id, 3, now)
  expect(read(reviewed, 'repeaty_study_stats')).toMatchObject({
    totals: { cards: 1 },
    today: { reviews: 1, ratings: { good: 1 } },
  })
  const undone = undoReview(reviewed)
  const before = JSON.stringify(undone)
  for (const tool of [
    'repeaty_due_cards',
    'repeaty_study_stats',
    'repeaty_practice_history',
  ] as const)
    read(undone, tool)
  expect(JSON.stringify(undone)).toBe(before)
  expect(read(undone, 'repeaty_study_stats')).toMatchObject({
    today: { reviews: 0, ratings: { good: 0 } },
  })
})
