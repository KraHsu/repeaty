import { expect, it } from 'vitest'
import type { Source } from './source-data'
import { startReadingRound, advanceReadingRound, reconcileReadingRound } from './reading-round'

const today = '2026-10-20'
function source(id: string, overrides: Partial<Source> = {}): Source {
  return {
    id,
    title: id,
    url: '',
    format: 'plain',
    mediaId: `body-${id}`,
    characters: 100,
    createdAt: '2026-10-19T00:00:00Z',
    ...overrides,
  }
}

it('captures ready snapshot identities in priority and date order without retaining mutable sources', () => {
  const sources = [
    source('low', { priority: 'low' }),
    source('normal'),
    source('high', { priority: 'high' }),
    source('later', { priority: 'high', queue: { state: 'active', availableOn: '2026-10-21' } }),
    source('archived', { queue: { state: 'archived', availableOn: today } }),
  ]
  const original = structuredClone(sources)
  const round = startReadingRound(sources, today)
  expect(round.entries.map((entry) => entry.sourceId)).toEqual(['high', 'normal', 'low'])
  expect(round.cursor).toBe(0)
  expect(sources).toEqual(original)
  sources[2]!.mediaId = 'replacement'
  expect(round.entries[0]!.mediaId).toBe('body-high')
})

it('keeps the starting order through priority changes, repeated visits and newly available materials', () => {
  const sources = [source('a'), source('b'), source('c')]
  let round = startReadingRound(sources, today)
  sources[0]!.priority = 'low'
  sources[2]!.priority = 'high'
  sources[0]!.reading = {
    offset: 80,
    fraction: 0,
    view: 'source',
    updatedAt: '2026-10-20T00:00:00Z',
  }
  sources.push(source('new', { priority: 'high' }))
  expect(reconcileReadingRound(round, sources, today)).toBe(round)
  const visited: string[] = []
  while (round.cursor < round.entries.length) {
    visited.push(round.entries[round.cursor]!.sourceId)
    round = advanceReadingRound(round, sources, '2026-10-21')
  }
  expect(visited).toEqual(['a', 'b', 'c'])
  expect(advanceReadingRound(round, sources, today)).toBe(round)
  expect(startReadingRound(sources, today).entries.map((entry) => entry.sourceId)).toEqual([
    'c',
    'new',
    'b',
    'a',
  ])
})

it('skips removed, replaced, deferred and archived snapshots and reaches a finite end', () => {
  const sources = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => source(id))
  const round = startReadingRound(sources, today)
  const changed = sources
    .filter((entry) => entry.id !== 'b')
    .map((entry) =>
      entry.id === 'c'
        ? { ...entry, mediaId: 'different' }
        : entry.id === 'd'
          ? { ...entry, queue: { state: 'active' as const, availableOn: '2026-10-21' } }
          : entry.id === 'e'
            ? { ...entry, queue: { state: 'archived' as const, availableOn: today } }
            : entry,
    )
  const next = advanceReadingRound(round, changed, today)
  expect(next.entries[next.cursor]!.sourceId).toBe('f')
  expect(reconcileReadingRound(next, [], today).cursor).toBe(round.entries.length)
  expect(round.cursor).toBe(0)
})

it('skips an invalid current snapshot without touching its replacement or importing new entries', () => {
  const original = [source('a'), source('b')]
  const round = startReadingRound(original, today)
  const changed = [source('a', { mediaId: 'replacement' }), source('b'), source('new')]
  const before = structuredClone(changed)
  const next = reconcileReadingRound(round, changed, today)
  expect(next.cursor).toBe(1)
  expect(advanceReadingRound(next, changed, today).cursor).toBe(2)
  expect(changed).toEqual(before)
})

it('handles an empty ready queue without fabricating an item', () => {
  const round = startReadingRound([], today)
  expect(round).toEqual({ entries: [], cursor: 0 })
  expect(reconcileReadingRound(round, [], today)).toBe(round)
  expect(advanceReadingRound(round, [], today)).toBe(round)
})
