import { expect, it } from 'vitest'
import { fixture, input, now } from './test-fixtures'
import { librarySchema, removeNotes, saveNote } from './model'
import { reviewCard } from './scheduler'
import { addSource, prepareSource, saveReadingPosition } from './sources'
import { arrangeSource } from './source-queue'
import { operationFor, revertOperation, replayOperation } from './operations'

it('undoes create, edit, type changes and deletion with original IDs, ordering and reviews', () => {
  const first = fixture({ type: 'reversed' })
  const before = reviewCard(first, first.cards[0]!.id, 3, now)
  for (const after of [
    saveNote(before, { ...input, front: 'Added' }, undefined, false, now),
    saveNote(before, { ...input, type: 'basic', front: 'Edited' }, before.notes[0]!.id, true, now),
    removeNotes(before, new Set([before.notes[0]!.id])),
  ]) {
    const entry = operationFor(before, after, 'local:test', '修改')!
    const restored = revertOperation(after, entry)
    expect(restored).toEqual(before)
    expect(librarySchema.parse(restored)).toEqual(before)
    expect(after).not.toBe(restored)
  }
})

it('keeps later reading positions and unrelated metadata while undoing only the intended fields', () => {
  const { source, asset } = prepareSource(
    { title: 'Original', url: '', format: 'plain', content: 'text\n'.repeat(200) },
    now,
  )
  const before = addSource(fixture(), source, asset)
  const after = arrangeSource(before, source.id, source.mediaId, { type: 'archive' }, now)
  const entry = operationFor(before, after, 'local:test', '阅读安排', 'reading')!
  const later = saveReadingPosition(
    after,
    source.id,
    source.mediaId,
    { offset: 100, fraction: 0, view: 'source' },
    now,
  )
  const concurrent = {
    ...later,
    sources: later.sources.map((row) => ({ ...row, title: 'Later title' })),
  }
  const restored = revertOperation(concurrent, entry)
  expect(restored.sources[0]!.queue).toEqual(before.sources[0]!.queue)
  expect(restored.sources[0]!.reading?.offset).toBe(100)
  expect(restored.sources[0]!.title).toBe('Later title')
  expect(restored.cards).toBe(before.cards)
  expect(restored.reviews).toBe(before.reviews)
  expect(operationFor(after, later, 'local:test', '修改')).toBeUndefined()
})

it('refuses stale or reused records without changing any part of the library', () => {
  const before = fixture()
  const after = saveNote(before, { ...input, front: 'Edited' }, before.notes[0]!.id, false, now)
  const entry = operationFor(before, after, 'local:test', '修改')!
  const stale = {
    ...after,
    notes: after.notes.map((note) => ({ ...note, front: 'Changed elsewhere' })),
  }
  const snapshot = JSON.stringify(stale)
  expect(() => revertOperation(stale, entry)).toThrow('已变化')
  expect(JSON.stringify(stale)).toBe(snapshot)
  const deleted = removeNotes(before, new Set([before.notes[0]!.id]))
  const deletion = operationFor(before, deleted, 'local:test', '修改')!
  expect(() => revertOperation(before, deletion)).toThrow('已变化')
})

it('stores the bounded rating delta and replays the exact ID, time and schedule', () => {
  const before = fixture()
  const after = reviewCard(before, before.cards[0]!.id, 3, now)
  const operation = operationFor(before, after, 'local:test', '评分', 'review')!
  expect(operation.changes.map((change) => change.store)).toEqual(['cards', 'reviews'])
  expect(operation.reviewId).toBe(after.reviews[0]!.id)
  expect(JSON.stringify(operation).length).toBeLessThan(4000)
  expect(revertOperation(after, operation)).toEqual(before)
  expect(replayOperation(before, operation)).toEqual(after)
  expect(() => replayOperation(after, operation)).toThrow('已变化')
})
