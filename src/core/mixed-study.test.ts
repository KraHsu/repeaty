import { expect, it } from 'vitest'
import { fixture, input, now } from './test-fixtures'
import { saveNote } from './model'
import { addSource, prepareSource } from './sources'
import { startMixedRound, nextMixedTask, finishMixedCard, finishMixedReading } from './mixed-study'
import { reviewCard } from './scheduler'

function setup() {
  let library = fixture()
  for (let index = 1; index <= 4; index++)
    library = saveNote(library, { ...input, front: `Card ${index}` }, undefined, false, now)
  for (const title of ['Read A', 'Read B']) {
    const { source, asset } = prepareSource(
      { title, url: '', format: 'plain', content: `Reading ${title}` },
      now,
    )
    library = addSource(library, source, asset)
  }
  return library
}
it('interleaves live FSRS cards and a finite reading snapshot at the chosen ratio', () => {
  let library = setup(),
    round = startMixedRound(library, now, 3)
  const kinds: string[] = []
  for (let i = 0; i < 8; i++) {
    const next = nextMixedTask(round, library, now)
    if (!next) break
    kinds.push(next.kind)
    if (next.kind === 'card') {
      library = reviewCard(library, next.id, 3, now)
      round = finishMixedCard(round)
    } else round = finishMixedReading(round, next.index)
  }
  expect(kinds).toEqual(['card', 'card', 'card', 'reading', 'card', 'card', 'reading'])
  expect(round).toMatchObject({ completedCards: 5, completedReadings: 2 })
  expect(nextMixedTask(round, library, now)).toBeUndefined()
})
it('respects quotas and plugin availability, continuing readings without advancing card schedules', () => {
  let library = setup()
  library.decks[0]!.newLimit = 1
  let round = startMixedRound(library, now, 3)
  const card = nextMixedTask(round, library, now)!
  expect(card.kind).toBe('card')
  library = reviewCard(library, card.id, 3, now)
  round = finishMixedCard(round)
  const afterCards = structuredClone(library.cards)
  for (let index = 0; index < 2; index++) {
    const next = nextMixedTask(round, library, now)!
    expect(next.kind).toBe('reading')
    if (next.kind === 'reading') round = finishMixedReading(round, next.index)
  }
  expect(nextMixedTask(round, library, now)).toBeUndefined()
  expect(library.cards).toEqual(afterCards)
  const disabled = setup()
  expect(nextMixedTask(startMixedRound(disabled, now), disabled, now, () => false)?.kind).toBe(
    'reading',
  )
})
it('returns relearning cards when due, skips missing or replaced material, and excludes later imports', () => {
  let library = setup()
  library = { ...library, cards: library.cards.slice(0, 1), notes: library.notes.slice(0, 1) }
  let round = startMixedRound(library, now, 1)
  const card = nextMixedTask(round, library, now)!
  library = reviewCard(library, card.id, 1, now)
  round = finishMixedCard(round)
  const reading = nextMixedTask(round, library, now)!
  expect(reading.kind).toBe('reading')
  if (reading.kind === 'reading') round = finishMixedReading(round, reading.index)
  const again = new Date(now.getTime() + 10 * 60_000)
  expect(nextMixedTask(round, library, again)).toMatchObject({ kind: 'card', id: card.id })
  const added = prepareSource(
    { title: 'New', url: '', format: 'plain', content: 'Later import' },
    now,
  )
  library = addSource(library, added.source, added.asset)
  const remaining = round.sources[round.cursor]!
  library = {
    ...library,
    sources: library.sources.map((s) =>
      s.id === remaining.id ? { ...s, mediaId: 'replacement' } : s,
    ),
  }
  expect(nextMixedTask(round, library, now)).toBeUndefined()
})
it('rejects invalid mixing ratios rather than creating a stalled queue', () => {
  for (const ratio of [0, -1, 11, 1.5, Infinity, Number.NaN])
    expect(() => startMixedRound(setup(), now, ratio)).toThrow()
})
