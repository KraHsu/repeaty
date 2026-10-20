import { expect, it } from 'vitest'
import type { Source } from './source-data'
import { filterSources, queuedSources, type SourceFilter } from './source-queue'
import { startReadingRound, advanceReadingRound } from './reading-round'

const today = '2026-10-20'
function source(id: string, overrides: Partial<Source> = {}): Source {
  return {
    id,
    title: `Reading 中文 ${id}`,
    url: '',
    format: 'plain',
    mediaId: `body-${id}`,
    characters: 100,
    createdAt: '2026-10-19T00:00:00Z',
    ...overrides,
  }
}

it('combines title, kind and priority while preserving old defaults and detached excerpts', () => {
  const sources = [
    source('old'),
    source('explicit-normal', { priority: 'normal' }),
    source('high-original', { priority: 'high' }),
    source('high-excerpt', { kind: 'excerpt', priority: 'high' }),
    source('low-excerpt', { kind: 'excerpt', priority: 'low' }),
    source('other-title', { title: 'Other topic', kind: 'excerpt', priority: 'high' }),
  ]
  const before = structuredClone(sources)
  expect(filterSources(sources, { kind: 'original', priority: 'normal' }).map((s) => s.id)).toEqual(
    ['old', 'explicit-normal'],
  )
  expect(
    filterSources(sources, { query: '  READING 中文  ', kind: 'excerpt', priority: 'high' }).map(
      (s) => s.id,
    ),
  ).toEqual(['high-excerpt'])
  expect(filterSources(sources, { query: 'body-high-excerpt' })).toEqual([])
  expect(filterSources(sources, { query: '   ', kind: 'all', priority: 'all' })).toEqual(sources)
  expect(sources).toEqual(before)
})

it('applies the same filters to every queue without changing eligibility or stable ordering', () => {
  const sources = [
    source('low', { kind: 'excerpt', priority: 'low' }),
    source('normal', { kind: 'excerpt' }),
    source('high', { kind: 'excerpt', priority: 'high' }),
    source('original', { priority: 'high' }),
    source('future', {
      kind: 'excerpt',
      priority: 'high',
      queue: { state: 'active', availableOn: '2026-10-21' },
    }),
    source('archive', {
      kind: 'excerpt',
      priority: 'high',
      queue: { state: 'archived', availableOn: today },
    }),
  ]
  const filter: SourceFilter = { kind: 'excerpt', query: '中文' }
  const ids = (view: Parameters<typeof queuedSources>[1]) =>
    queuedSources(sources, view, today, filter).map((s) => s.id)
  expect(ids('ready')).toEqual(['high', 'normal', 'low'])
  expect(ids('deferred')).toEqual(['future'])
  expect(ids('archived')).toEqual(['archive'])
  expect(ids('all')).toEqual(['high', 'normal', 'low', 'future', 'archive'])
  expect(
    queuedSources(sources, 'all', today, { ...filter, priority: 'high' }).map((s) => s.id),
  ).toEqual(['high', 'future', 'archive'])
})

it('captures all matching ready identities across pages and keeps membership fixed during a round', () => {
  const sources = Array.from({ length: 45 }, (_, index) =>
    source(String(index).padStart(2, '0'), { kind: 'excerpt', priority: 'high' }),
  )
  sources.push(
    source('original', { priority: 'high' }),
    source('normal', { kind: 'excerpt' }),
    source('future', {
      kind: 'excerpt',
      priority: 'high',
      queue: { state: 'active', availableOn: '2026-10-21' },
    }),
    source('archive', {
      kind: 'excerpt',
      priority: 'high',
      queue: { state: 'archived', availableOn: today },
    }),
  )
  const filter: SourceFilter = { kind: 'excerpt', priority: 'high' }
  let round = startReadingRound(sources, today, filter)
  expect(round.entries).toHaveLength(45)
  const before = structuredClone(round.entries)
  sources[1]!.priority = 'low'
  sources[2]!.title = 'Changed title'
  sources.push(source('new', { kind: 'excerpt', priority: 'high' }))
  filter.query = 'no match'
  const visited: string[] = []
  while (round.cursor < round.entries.length) {
    visited.push(round.entries[round.cursor]!.sourceId)
    round = advanceReadingRound(round, sources, '2026-10-21')
  }
  expect(visited).toEqual(before.map((entry) => entry.sourceId))
  expect(startReadingRound(sources, today, filter).entries).toEqual([])
  expect(startReadingRound(sources, today).entries).toHaveLength(48)
})
