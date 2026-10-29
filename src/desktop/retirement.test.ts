import { expect, it } from 'vitest'
import { fixture, input, now } from '../core/test-fixtures'
import { reviewCard } from '../core/scheduler'
import { noteLifecycle, type RetiredNote } from './retirement'
import { registerWorkspaceNote, readWorkspaceMarkdown } from '../workspace/markdown'
const empty = (): RetiredNote => ({
  revision: 0,
  note: null,
  document: null,
  cards: [],
  reviews: [],
  practices: [],
  attempts: [],
  media: [],
})
it('adds a direction without changing the existing card or rating', () => {
  const before = fixture({ format: 'markdown' }),
    rated = reviewCard(before, before.cards[0]!.id, 3, now)
  const plan = noteLifecycle(rated, { ...input, type: 'reversed' }, rated.notes[0]!.id, empty())
  expect(plan).toMatchObject({ keep: 1, create: 1, restore: 0, retire: 0 })
  expect(plan.library.cards[0]).toBe(rated.cards[0])
  expect(plan.library.reviews).toEqual(rated.reviews)
})
it('retiring and re-adding a cloze number restores its original identity, schedule and history', () => {
  let before = fixture({ type: 'cloze', front: '{{c1::A}} {{c2::B}}', back: 'Details' })
  before.decks[0]!.burySiblings = false
  before = reviewCard(before, before.cards[0]!.id, 2, now)
  before = reviewCard(before, before.cards[1]!.id, 3, new Date(now.getTime() + 1000))
  const id = before.notes[0]!.id,
    old = before.cards[0]!
  expect(() =>
    noteLifecycle(before, { ...before.notes[0]!, front: 'A {{c2::B}}' }, id, empty()),
  ).toThrow()
  const reduced = noteLifecycle(
    before,
    { ...before.notes[0]!, front: 'A {{c2::B}}' },
    id,
    empty(),
    true,
  )
  const archive = {
    ...empty(),
    cards: [old],
    reviews: before.reviews.filter((review) => review.cardId === old.id),
  }
  const restored = noteLifecycle(reduced.library, before.notes[0]!, id, archive)
  expect(restored).toMatchObject({ keep: 1, restore: 1, create: 0, retire: 0 })
  expect(restored.library.cards.find((card) => card.id === old.id)).toEqual(old)
  expect(restored.library.reviews).toEqual(before.reviews)
  expect(restored.library.cards.find((card) => card.id === before.cards[1]!.id)).toBe(
    before.cards[1],
  )
})
it('does not merge archived histories that collide with active record ids', () => {
  const before = fixture({ type: 'reversed' }),
    rated = reviewCard(before, before.cards[0]!.id, 3, now)
  const archived = {
    ...empty(),
    cards: [{ ...before.cards[1]!, id: 'archived-reverse' }],
    reviews: [{ ...rated.reviews[0]!, cardId: 'archived-reverse' }],
  }
  const active = {
    ...rated,
    cards: rated.cards.slice(0, 1),
    notes: [{ ...rated.notes[0]!, type: 'basic' as const }],
  }
  expect(() =>
    noteLifecycle(active, { ...input, type: 'reversed' }, active.notes[0]!.id, archived),
  ).toThrow()
})
const defaults = {
  id: 'external-note',
  type: 'basic' as const,
  deckId: 'deck',
  format: 'markdown' as const,
}
it('registers new ordinary Markdown with a stable identity and lossless body', () => {
  const raw = '  外部题目🙂\n<!-- repeaty:answer -->\n\n答案\n'
  const doc = registerWorkspaceNote(raw, defaults)
  expect(doc.identity).toEqual({ kind: 'note', id: defaults.id })
  expect(doc.content).toEqual({ kind: 'note', front: '  外部题目🙂', back: '\n答案\n' })
  expect(registerWorkspaceNote(doc.raw, defaults).raw).toBe(doc.raw)
})
it('inserts identity into a CRLF/BOM header without dropping comments or unknown properties', () => {
  const raw =
    '\uFEFF---\r\n# keep this comment\r\ncustom: [a, b]\r\nrepeaty: {version: 1, kind: note, type: basic, format: markdown, deckId: deck}\r\n---\r\n题目\r\n<!-- repeaty:answer -->\r\n答案\r\n'
  expect(readWorkspaceMarkdown(raw).status).toBe('unregistered')
  const doc = registerWorkspaceNote(raw, defaults)
  expect(doc.raw.startsWith('\uFEFF---\r\n# keep this comment\r\n')).toBe(true)
  expect(doc.properties.custom).toEqual(['a', 'b'])
  expect(doc.content).toMatchObject({ front: '题目', back: '答案\r\n' })
  expect(doc.raw).not.toMatch(/(?<!\r)\n/)
})
it('accepts a cloze-only file and requires an answer boundary for basic notes', () => {
  expect(() => registerWorkspaceNote('Question without an answer', defaults)).toThrow(
    'missing-answer-boundary',
  )
  const doc = registerWorkspaceNote('记住{{c1::内容}}\n', { ...defaults, type: 'cloze' })
  expect(doc.variants).toEqual(['cloze:1'])
  expect(doc.content).toMatchObject({ front: '记住{{c1::内容}}\n', back: '' })
})
it('does not replace a managed identity or repair invalid YAML by guessing', () => {
  const doc = registerWorkspaceNote('Q\n<!-- repeaty:answer -->\nA', defaults)
  expect(() => registerWorkspaceNote(doc.raw, { ...defaults, id: 'other' })).toThrow()
  expect(() =>
    registerWorkspaceNote('---\ncustom: [unclosed\n---\nQ\n<!-- repeaty:answer -->\nA', defaults),
  ).toThrow()
})

it('adds the Repeaty map to unrelated YAML frontmatter without losing existing fields', () => {
  const raw =
    '\uFEFF---\r\n# custom comment\r\ntitle: 外部笔记\r\ncustom: [a, b]\r\n---\r\n题目\r\n<!-- repeaty:answer -->\r\n答案'
  const doc = registerWorkspaceNote(raw, defaults)
  expect(doc.properties.custom).toEqual(['a', 'b'])
  expect(doc.properties.title).toBe('外部笔记')
  expect(doc.raw.startsWith('\uFEFF---\r\n# custom comment')).toBe(true)
  expect(doc.identity.id).toBe(defaults.id)
})
