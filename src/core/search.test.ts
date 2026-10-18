import { describe, expect, it } from 'vitest'
import { fixture, input, now } from './test-fixtures'
import { saveNote, localDay, type SearchFilter } from './model'
import { searchCards, saveSearch, studyCards } from './search'
import { changeCards, reviewCard } from './scheduler'
const filter = (query: string): SearchFilter => ({ query, deckId: '', state: 'all' })
function collection() {
  let library = fixture({ front: 'active recall', tags: ['English', 'two words'] })
  library.decks[0]!.name = 'Study notes'
  library = saveNote(
    library,
    { ...input, front: 'second', tags: ['english'], type: 'reversed' },
    undefined,
    false,
    now,
  )
  library.cards[0]!.leech = true
  library.cards[0]!.schedule.lapses = 4
  return library
}
describe('structured search and saved filters', () => {
  it('combines exact tags, quoted phrases, negation, types and numeric comparisons', () => {
    const library = collection()
    expect(
      searchCards(
        library,
        filter('tag:english deck:"Study notes" "active recall" lapses:>=3 -is:suspended'),
        now,
      ),
    ).toHaveLength(1)
    expect(searchCards(library, filter('tag:"two words" is:leech'), now)).toHaveLength(1)
    expect(searchCards(library, filter('type:reversed -is:leech'), now)).toHaveLength(2)
    expect(searchCards(library, filter('tag:eng'), now)).toHaveLength(0)
    expect(searchCards(library, filter('"no match"'), now)).toHaveLength(0)
  })
  it('uses local calendar offsets for due searches and exposes buried/suspended cards', () => {
    const library = collection()
    const future = new Date(now)
    future.setDate(future.getDate() + 7)
    library.cards[0]!.schedule.due = future.toISOString()
    expect(searchCards(library, filter('due:7'), now)).toHaveLength(1)
    expect(searchCards(library, filter('due:<=0'), now)).toHaveLength(2)
    expect(searchCards(library, filter('is:due'), now)).toHaveLength(2)
    library.cards[0]!.suspended = true
    expect(searchCards(library, filter('is:suspended'), now)).toHaveLength(1)
    library.cards[1]!.autoBurial = { day: localDay(now), reviewId: 'r' }
    expect(searchCards(library, filter('is:buried'), now)).toHaveLength(1)
    expect(searchCards(library, { ...filter(''), state: '顽固卡' }, now)).toHaveLength(1)
  })
  it.each(['is:typo', 'lapses:>bad', 'due:>', 'tag:', '"unterminated', 'type:unknown', '-'])(
    'rejects invalid condition %s',
    (query) => {
      expect(() => searchCards(collection(), filter(query), now)).toThrow()
    },
  )
  it('saves and updates dynamic filters without storing card IDs or changing progress', () => {
    const original = collection()
    const saved = saveSearch(original, filter('is:due'), 'Due cards', 'saved')
    expect(saved.cards).toEqual(original.cards)
    expect(saved.savedSearches[0]).toEqual({ ...filter('is:due'), name: 'Due cards', id: 'saved' })
    const updated = saveSearch(saved, filter('is:leech'), 'Difficult', 'saved')
    expect(updated.savedSearches).toHaveLength(1)
    expect(updated.savedSearches[0]!.query).toBe('is:leech')
    expect(() => saveSearch(original, filter('due:nan'), 'bad')).toThrow()
    expect(() => saveSearch(original, { ...filter(''), deckId: 'missing' }, 'bad')).toThrow()
  })
  it('builds one-pass practice queues without writes and rechecks availability after ratings', () => {
    const library = collection()
    const ids = library.cards.map((card) => card.id)
    const before = structuredClone(library)
    expect(studyCards(library, [...ids, ids[0]!, 'missing'], [ids[0]!], now)).toHaveLength(2)
    expect(library).toEqual(before)
    const paused = changeCards(library, new Set([ids[0]!]), 'suspend')
    expect(studyCards(paused, ids, [], now)).toHaveLength(2)
    const graded = reviewCard(paused, ids[1]!, 4, now, 'filtered')
    expect(studyCards(graded, ids, [ids[1]!], now)).toHaveLength(0)
  })
})
