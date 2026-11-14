import { expect, it } from 'vitest'
import { excerptsForSource, matchingExcerpts, excerptPreview } from './source-navigation'
import {
  addSource,
  prepareSource,
  prepareSourceExcerpt,
  removeSource,
  sourceExcerpt,
} from './sources'
import { librarySchema, saveNote } from './model'
import { reviewCard } from './scheduler'
import { fixture, input, now } from './test-fixtures'

function sample() {
  const text = 'Same🙂\nSame🙂\nText for another excerpt'
  const root = prepareSource({ title: 'Root', url: '', format: 'plain', content: text }, now)
  const first = sourceExcerpt(root.source, text, 0, 6)
  const second = sourceExcerpt(root.source, text, 7, 13)
  const early = prepareSourceExcerpt(root.source, text, first, 'Early', now)
  const late = prepareSourceExcerpt(root.source, text, second, 'Late', now)
  const duplicate = prepareSourceExcerpt(
    root.source,
    text,
    second,
    'Duplicate',
    new Date(now.getTime() + 1000),
  )
  let library = addSource(fixture(), root.source, root.asset)
  for (const entry of [late, duplicate, early])
    library = addSource(library, entry.source, entry.asset)
  return { library, text, root, early, late, duplicate, first, second }
}

it('lists all children by source position and counts actual cards without changing learning records', () => {
  const data = sample(),
    { root, early, late } = data
  let library = saveNote(data.library, {
    ...input,
    type: 'reversed',
    excerpt: sourceExcerpt(late.source, 'Same🙂', 0, 6),
  })
  library = saveNote(library, {
    ...input,
    type: 'cloze',
    front: '{{c1::Same}} {{c2::🙂}}',
    excerpt: sourceExcerpt(late.source, 'Same🙂', 0, 6),
  })
  library = reviewCard(library, library.cards[0]!.id, 3, now)
  library.sources = library.sources.map((source) =>
    source.id === early.source.id
      ? { ...source, priority: 'high', queue: { state: 'archived', availableOn: '2026-10-17' } }
      : source,
  )
  librarySchema.parse(library)
  const before = structuredClone(library)
  const entries = excerptsForSource(library, root.source.id)
  expect(entries.map((entry) => entry.source.title)).toEqual(['Early', 'Late', 'Duplicate'])
  expect(entries.map((entry) => entry.cards)).toEqual([0, 4, 0])
  expect(entries[0]!.source.queue?.state).toBe('archived')
  expect(library).toEqual(before)
  expect(excerptsForSource(library, late.source.id)).toEqual([])
  expect(excerptsForSource(library, 'missing')).toEqual([])
})

it('matches exact anchors, preserving legitimate duplicates and distinguishing repeated or partial text', () => {
  const { library, root, first, second, late, duplicate } = sample()
  const entries = excerptsForSource(library, root.source.id)
  expect(first.quote).toBe(second.quote)
  expect(matchingExcerpts(entries, second).map((entry) => entry.source.id)).toEqual([
    late.source.id,
    duplicate.source.id,
  ])
  expect(matchingExcerpts(entries, { ...second, sourceId: 'other' })).toEqual([])
  expect(matchingExcerpts(entries, { ...second, end: second.end - 2, quote: 'Same' })).toEqual([])
  expect(matchingExcerpts(entries)).toEqual([])
})

it('does not combine children from other snapshots or detached excerpts after deletion', () => {
  const { library, root, early, first, text } = sample()
  const other = prepareSource({ title: 'Other root', url: '', format: 'plain', content: text }, now)
  const child = prepareSourceExcerpt(
    other.source,
    text,
    { ...first, sourceId: other.source.id, mediaId: other.source.mediaId },
    'Other child',
    now,
  )
  let next = addSource(addSource(library, other.source, other.asset), child.source, child.asset)
  expect(excerptsForSource(next, root.source.id)).toHaveLength(3)
  expect(excerptsForSource(next, other.source.id).map((entry) => entry.source.id)).toEqual([
    child.source.id,
  ])
  next = removeSource(next, early.source.id)
  expect(excerptsForSource(next, root.source.id)).toHaveLength(2)
  next = removeSource(next, root.source.id)
  expect(excerptsForSource(next, root.source.id)).toEqual([])
  expect(excerptsForSource(next, other.source.id)).toHaveLength(1)
})

it('bounds previews without splitting Unicode and treats markup as plain text', () => {
  const text = 'before\n  <script>unsafe()</script>\n\tSame🙂  \nafter'
  const origin = { sourceId: 'root', start: 7, end: text.indexOf('after') }
  expect(excerptPreview(text, origin)).toBe('<script>unsafe()</script> Same🙂')
  const long = 'x'.repeat(159) + '🙂rest'
  expect(excerptPreview(long, { ...origin, start: 0, end: long.length })).toBe(
    'x'.repeat(159) + '…',
  )
  expect(excerptPreview(text, { ...origin, end: text.length + 1 })).toBe('')
  expect(excerptPreview(text, { ...origin, end: 0 })).toBe('')
})
