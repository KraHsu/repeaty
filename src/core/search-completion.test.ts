import { describe, expect, it } from 'vitest'
import { searchCompletions, type SearchVocabulary } from './search-completion'
import { compileSearch, searchCards } from './search'
import { fixture } from './test-fixtures'

const vocabulary: SearchVocabulary = {
  tags: ['English', 'english', 'two words', 'say "hello"', 'C:\\notes', '英语'],
  decks: ['Study notes', '中文卡组'],
}
function complete(query: string, caret = query.length, end = caret) {
  return searchCompletions(query, caret, end, vocabulary)
}

describe('card search completion', () => {
  it('offers valid supported syntax and real library values on focus', () => {
    const choices = complete('')
    expect(choices.some((choice) => choice.token === 'is:due')).toBe(true)
    expect(choices.some((choice) => choice.token === 'tag:English')).toBe(true)
    expect(choices.some((choice) => choice.token === 'deck:"Study notes"')).toBe(true)
    expect(choices).toHaveLength(10)
    for (const choice of choices)
      expect(() =>
        compileSearch([], { query: choice.query, state: 'all', deckId: '' }),
      ).not.toThrow()
  })

  it('matches prefixes case-insensitively and deduplicates exact tag semantics', () => {
    expect(complete('TAG:en').map((choice) => choice.token)).toEqual(['tag:English'])
    expect(complete('英').map((choice) => choice.token)).toEqual(['tag:英语'])
    expect(complete('is:du').map((choice) => choice.token)).toEqual(['is:due'])
    expect(complete('type:cl').map((choice) => choice.token)).toEqual(['type:cloze'])
    expect(complete('due:<').map((choice) => choice.token)).toEqual([
      'due:<=0',
      'due:<=7',
      'due:<0',
    ])
  })

  it('preserves surrounding conditions, whitespace, negation and caret placement', () => {
    const query = 'is:new -tag:en\t"active recall"'
    const choice = complete(query, query.indexOf('\t'))[0]!
    expect(choice.query).toBe('is:new -tag:English\t"active recall"')
    expect(choice.caret).toBe(choice.query.indexOf('"active recall"'))
    expect(complete('tag:en')[0]!.query).toBe('tag:English ')
    expect(complete('tag:en')[0]!.caret).toBe('tag:English '.length)
  })

  it('replaces the full condition when editing inside it, without consuming the next one', () => {
    const choice = complete('tag:engxxx is:new', 6)[0]!
    expect(choice.query).toBe('tag:English is:new')
    expect(complete('tag:en is:new', 2, 10)).toEqual([])
  })

  it('completes unfinished quoted values and round-trips spaces, quotes and backslashes', () => {
    for (const [fragment, value] of [
      ['tag:"two', 'two words'],
      ['tag:"say \\"he', 'say "hello"'],
      ['tag:"C:', 'C:\\notes'],
    ]) {
      const choice = complete(fragment!)[0]!
      const library = fixture({ tags: [value!] })
      expect(searchCards(library, { query: choice.query, state: 'all', deckId: '' })).toHaveLength(
        1,
      )
    }
    const deck = complete('deck:"Study')[0]!
    const library = fixture()
    library.decks[0]!.name = 'Study notes'
    expect(searchCards(library, { query: deck.query, state: 'all', deckId: '' })).toHaveLength(1)
  })

  it('leaves ordinary phrases, unknown conditions and unmatched free text untouched', () => {
    for (const query of ['"two words', '-"active recall"', 'unknown:tag', 'zzzz', 'is:due'])
      expect(complete(query)).toEqual([])
  })

  it('limits results and prevents a completion from crossing the query length limit', () => {
    expect(searchCompletions('tag:', 4, 4, { tags: Array(40).fill('x'), decks: [] })).toHaveLength(
      1,
    )
    expect(complete('x'.repeat(990) + ' tag:en')).toEqual([])
    expect(complete('x'.repeat(1001))).toEqual([])
    expect(searchCompletions('tag:', 4, 4, { tags: [], decks: [] })).toEqual([])
  })
})
