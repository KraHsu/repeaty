import { expect, it } from 'vitest'
import { fixture, now } from './test-fixtures'
import {
  arrangeSources,
  sourceArrangement,
  readingUndoFor,
  undoReading,
  canUndoReading,
} from './reading-operations'
import type { Source, SourceTarget } from './source-data'
import { arrangeSource } from './source-queue'
import { reviewCard } from './scheduler'

function sample() {
  const library = fixture()
  library.sources = ['a', 'b', 'c'].map((id): Source => ({
    id,
    title: id,
    url: '',
    mediaId: `body-${id}`,
    characters: 100,
    format: 'plain',
    createdAt: now.toISOString(),
    ...(id === 'b'
      ? {
          readingIntervalDays: 7,
          priority: 'high',
          queue: { state: 'active', availableOn: '2099-12-31' },
        }
      : {}),
  }))
  const targets = library.sources
    .slice(0, 2)
    .map((s): SourceTarget => ({ id: s.id, mediaId: s.mediaId, before: sourceArrangement(s) }))
  return { library, targets }
}
it('applies a batch once while preserving independent dates, intervals and untouched sources', () => {
  const { library, targets } = sample()
  const before = structuredClone(library)
  const next = arrangeSources(library, targets, { type: 'priority', priority: 'low' }, now)
  expect(next.sources.slice(0, 2).map((s) => s.priority)).toEqual(['low', 'low'])
  expect(next.sources[1]!.queue).toEqual(library.sources[1]!.queue)
  expect(next.sources[1]!.readingIntervalDays).toBe(7)
  expect(next.sources[2]).toBe(library.sources[2])
  expect(next.cards).toBe(library.cards)
  expect(library).toEqual(before)
  expect(
    arrangeSources(
      next,
      next.sources
        .slice(0, 2)
        .map((s) => ({ id: s.id, mediaId: s.mediaId, before: sourceArrangement(s) })),
      { type: 'priority', priority: 'low' },
      now,
    ),
  ).toBe(next)
})
it('rejects stale or duplicate targets and invalid dates without partially applying a batch', () => {
  const { library, targets } = sample()
  const before = structuredClone(library)
  for (const selection of [
    [],
    [...targets, targets[0]!],
    [targets[0]!, { ...targets[1]!, mediaId: 'replaced' }],
    [targets[0]!, { ...targets[1]!, before: {} }],
  ])
    expect(() => arrangeSources(library, selection, { type: 'archive' }, now)).toThrow()
  expect(() =>
    arrangeSources(library, targets, { type: 'defer', date: '2026-10-17' }, now),
  ).toThrow()
  expect(library).toEqual(before)
})
it('undoes a batch without reverting later metadata, reading positions or actual card reviews', () => {
  const { library, targets } = sample()
  const arranged = arrangeSources(library, targets, { type: 'defer', date: '2099-12-31' }, now)
  const undo = readingUndoFor(library, arranged, 'local:test')!
  const current = reviewCard(arranged, arranged.cards[0]!.id, 3, now)
  current.sources = current.sources.map((s) => ({
    ...s,
    title: `Renamed ${s.id}`,
    reading: { offset: 50, fraction: 0, view: 'source', updatedAt: now.toISOString() },
  }))
  expect(canUndoReading(current, undo)).toBe(true)
  const restored = undoReading(current, undo)
  expect(restored.sources.map(sourceArrangement)).toEqual(library.sources.map(sourceArrangement))
  expect(restored.sources.map((s) => s.title)).toEqual(current.sources.map((s) => s.title))
  expect(restored.sources.map((s) => s.reading)).toEqual(current.sources.map((s) => s.reading))
  expect(restored.cards).toBe(current.cards)
  expect(restored.reviews).toBe(current.reviews)
  expect(readingUndoFor(restored, restored, 'local:test')).toBeUndefined()
})
it('refuses undo after an affected arrangement changes or its body is replaced or deleted', () => {
  const { library, targets } = sample()
  const next = arrangeSources(library, targets, { type: 'archive' }, now)
  const undo = readingUndoFor(library, next, 'local:test')!
  const changed = arrangeSource(next, targets[1]!.id, targets[1]!.mediaId, { type: 'restore' }, now)
  for (const current of [
    changed,
    { ...next, sources: next.sources.slice(1) },
    {
      ...next,
      sources: next.sources.map((s) => (s.id === 'a' ? { ...s, mediaId: 'replaced' } : s)),
    },
  ]) {
    expect(canUndoReading(current, undo)).toBe(false)
    expect(() => undoReading(current, undo)).toThrow()
  }
})
