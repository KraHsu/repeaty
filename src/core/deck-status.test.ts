import { expect, it } from 'vitest'
import { fixture, now, input } from './test-fixtures'
import { saveNote } from './model'
import { changeCards, reviewCard, dueCards } from './scheduler'
import { deckStudyCounts } from './deck-status'

it('distinguishes available new, learning and review cards, future cards, burial and limits', () => {
  let library = fixture()
  for (let i = 0; i < 4; i++)
    library = saveNote(library, { ...input, front: `Card ${i}` }, undefined, false, now)
  library.decks[0]!.newLimit = 1
  expect(deckStudyCounts(library, now).get('deck')).toMatchObject({
    total: 5,
    newTotal: 5,
    newReady: 1,
    limited: 4,
  })
  const selected = dueCards(library, now)[0]!.id
  const others = library.cards.filter((card) => card.id !== selected)
  library = reviewCard(library, selected, 1, now)
  library = changeCards(library, new Set([others[0]!.id]), 'suspend', now)
  library = changeCards(library, new Set([others[1]!.id]), 'bury', now)
  expect(deckStudyCounts(library, now).get('deck')).toMatchObject({
    newReady: 0,
    ready: 0,
    future: 1,
    suspended: 1,
    buried: 1,
    limited: 2,
  })
  expect(deckStudyCounts(library, new Date(now.getTime() + 600_000)).get('deck')).toMatchObject({
    learningReady: 1,
    ready: 1,
  })
  expect(deckStudyCounts(library, now, [], undefined, () => false).get('deck')).toMatchObject({
    ready: 0,
    limited: 0,
    future: 0,
    total: 5,
  })
})
