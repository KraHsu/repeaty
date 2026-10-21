import { describe, expect, it } from 'vitest'
import {
  cardViews,
  clozes,
  librarySchema,
  migrateLibrary,
  removeNotes,
  saveNote,
  type Library,
} from './model'
import { editNotes, importNotes, parseNoteImport, parseTable } from './batch'
import { fixture, input, legacyFixture, now } from './test-fixtures'
import { reviewCard } from './scheduler'

describe('note generation and migration', () => {
  it('creates one card per cloze number and hides repeated occurrences together', () => {
    const library = fixture({
      type: 'cloze',
      front: '{{c1::Paris::city}} is in {{c2::France}}. {{c1::Paris}}.',
      back: 'Extra',
    })
    const views = cardViews(library)
    expect(views).toHaveLength(2)
    expect(views[0]!.front).toBe('[city] is in France. […].')
    expect(views[1]!.front).toBe('Paris is in […]. Paris.')
    expect(views[0]!.back).toBe('Paris is in France. Paris.\n\nExtra')
  })
  it.each([
    'no blanks',
    '{{c0::bad}}',
    '{{c1::}}',
    '{{c1::good}} {{c2::broken',
    '{{c1::outer {{c2::inner}}}}',
  ])('rejects malformed cloze %s', (text) => {
    expect(() => clozes(text)).toThrow()
  })
  it('preserves IDs and schedules when note contents change, and confirms removed variants', () => {
    let library = fixture({ type: 'reversed' })
    const note = library.notes[0]!
    library = reviewCard(library, library.cards[0]!.id, 4, now)
    const original = structuredClone(library.cards)
    library = saveNote(library, { ...note, front: 'Updated question' }, note.id)
    expect(library.cards).toEqual(original)
    expect(cardViews(library)[1]!.back).toBe('Updated question')
    expect(() => saveNote(library, { ...note, type: 'basic' }, note.id)).toThrow('确认移除')
    const reduced = saveNote(library, { ...note, type: 'basic' }, note.id, true)
    expect(reduced.cards).toEqual([original[0]])
    expect(reduced.reviews).toHaveLength(1)
    expect(removeNotes(reduced, new Set([note.id])).reviews).toHaveLength(0)
  })
  it('keeps other cards in place when an early note is edited', () => {
    let library: Library = { ...fixture(), notes: [], cards: [] }
    const field = (front: string) => ({
      deckId: 'deck',
      type: 'basic' as const,
      format: 'plain' as const,
      front,
      back: 'answer',
      tags: [],
      frontMedia: [],
      backMedia: [],
    })
    for (let index = 0; index < 4; index++) library = saveNote(library, field(`Q${index}`))
    const before = library.cards.map((card) => [card.id, card.noteId])
    library = saveNote(library, field('Q0 edited'), library.notes[0]!.id)
    expect(library.cards.map((card) => [card.id, card.noteId])).toEqual(before)
  })
  it('migrates old content without changing card identity or schedule', () => {
    const legacy = legacyFixture()
    const migrated = migrateLibrary(legacy)
    expect(migrated.version).toBe(13)
    expect(migrated.notes[0]).toMatchObject({
      front: 'Legacy question',
      type: 'basic',
      tags: ['old'],
    })
    expect(migrated.cards[0]!.id).toBe('old-card')
    expect(migrated.cards[0]!.schedule).toEqual(legacy.cards[0]!.schedule)
    expect(migrateLibrary(migrated)).toEqual(migrated)
  })
  it('rejects orphan or duplicated generated cards', () => {
    const library = fixture()
    expect(librarySchema.safeParse({ ...library, cards: [] }).success).toBe(false)
    expect(
      librarySchema.safeParse({ ...library, cards: [...library.cards, library.cards[0]] }).success,
    ).toBe(false)
    expect(librarySchema.safeParse({ ...library, decks: [] }).success).toBe(false)
  })
})

describe('bulk import and edit', () => {
  it('parses BOM, escaped quotes, commas and multiline CSV fields', () => {
    const parsed = parseNoteImport(
      '\uFEFFtype,front,back,tags\r\nbasic,"Question, one","Line 1\nLine ""2""",a|b\r\n',
      'deck',
      ',',
    )
    expect(parsed[0]).toMatchObject({
      front: 'Question, one',
      back: 'Line 1\nLine "2"',
      tags: ['a', 'b'],
    })
    expect(parseNoteImport('front\tback\nHello\t你好', 'deck', '\t')[0]!.type).toBe('basic')
  })
  it.each([
    'front,back\n"unterminated,answer',
    'front,back\none,two,three',
    'front,back\n"one"invalid,two',
    'front,unknown\na,b',
  ])('rejects malformed imports atomically: %s', (text) => {
    expect(() => parseNoteImport(text, 'deck', ',')).toThrow()
  })
  it('supports reverse/cloze imports and skips duplicates within a file or existing deck', () => {
    const library = fixture()
    const imports = parseNoteImport(
      'type,front,back\nreversed,hello,你好\ncloze,{{c1::answer}},extra\nreversed,hello,你好',
      'deck',
      ',',
    )
    const result = importNotes(library, imports, true, now)
    expect(result.notes).toHaveLength(3)
    expect(result.cards).toHaveLength(4)
    expect(importNotes(result, imports, true, now)).toEqual(result)
  })
  it('moves and tags all siblings while keeping progress untouched', () => {
    const library = fixture({ type: 'reversed' })
    library.decks.push({ ...library.decks[0]!, id: 'other' })
    const edited = editNotes(
      library,
      new Set([library.notes[0]!.id]),
      { deckId: 'other', addTags: ['new', 'new'], removeTags: ['test'] },
      now,
    )
    expect(edited.notes[0]).toMatchObject({ deckId: 'other', tags: ['new'] })
    expect(edited.cards).toEqual(library.cards)
    expect(cardViews(edited).every((card) => card.deckId === 'other')).toBe(true)
    expect(() =>
      editNotes(library, new Set([library.notes[0]!.id]), {
        addTags: Array.from({ length: 21 }, (_, i) => `tag${i}`),
        removeTags: [],
      }),
    ).toThrow()
    expect(library.notes[0]!.tags).toEqual(input.tags)
  })
  it('rejects over-limit row counts', () => {
    expect(() => parseTable('a,b\n'.repeat(5003), ',')).toThrow('5000')
  })
})
