import { expect, it } from 'vitest'
import { fixture, now } from './test-fixtures'
import { cardViews } from './model'
import type { Source } from './source-data'
import { createPriorityResolver, weightedPriorityOrder, priorityWeight } from './study-priority'
import { studySettingsSchema } from './study-settings'
import { arrangeSource, filterSources, queuedSources } from './source-queue'
import { saveNote } from './model'
import { input } from './test-fixtures'
import { nextMixedTask, startMixedRound } from './mixed-study'
import { readingUndoFor, undoReading } from './reading-operations'
import { dueCards } from './scheduler'

function source(id: string, patch: Partial<Source> = {}): Source {
  return {
    id,
    title: id,
    url: '',
    mediaId: `media-${id}`,
    characters: 1,
    format: 'plain',
    createdAt: now.toISOString(),
    ...patch,
  }
}
it('honors explicit and inherited numeric priorities in legacy mode without changing ordinary queues', () => {
  const library = saveNote(fixture(), { ...input, front: 'Second' }, undefined, false, now)
  library.sources = [
    source('ordinary'),
    source('inherited', { folderId: 'folder' }),
    source('low', { priority: 'high', studyPriority: 9 }),
  ]
  const prioritized = library.cards.find((card) => card.noteId === library.notes[1]!.id)!.id
  const other = library.cards.find((card) => card.noteId !== library.notes[1]!.id)!.id
  library.materialFolders = [
    { id: 'folder', name: 'Folder', order: 0, createdAt: now.toISOString(), studyPriority: 0 },
  ]
  library.notes[1]!.studyPriority = 1
  expect(dueCards(library, now).map((card) => card.id)).toEqual([prioritized, other])
  expect(
    queuedSources(library.sources, 'ready', '2026-10-18', {}, library).map((source) => source.id),
  ).toEqual(['inherited', 'ordinary', 'low'])
  expect(
    filterSources(library.sources, { priority: 'high' }, library).map((source) => source.id),
  ).toEqual(['inherited'])
  expect(
    filterSources(library.sources, { priority: 'low' }, library).map((source) => source.id),
  ).toEqual(['low'])
  expect(nextMixedTask(startMixedRound(library, now), library, now)).toMatchObject({
    kind: 'reading',
    id: 'inherited',
  })
  library.notes[1]!.studyPriority = 0
  expect(nextMixedTask(startMixedRound(library, now), library, now)).toMatchObject({
    kind: 'card',
    id: prioritized,
  })
  const before = { ...library, sources: [source('explicit', { studyPriority: 0 })] }
  const changed = arrangeSource(
    before,
    'explicit',
    'media-explicit',
    { type: 'priority', priority: 'normal' },
    now,
  )
  expect(changed.sources[0]).toMatchObject({ priority: 'normal' })
  expect(changed.sources[0]!.studyPriority).toBeUndefined()
  const undo = readingUndoFor(before, changed, 'scope')!
  expect(undoReading(changed, undo).sources[0]!.studyPriority).toBe(0)
})
it('uses the nearest override and changes inheritance after moving without rewriting descendants', () => {
  const library = fixture()
  library.studySettings = [
    studySettingsSchema.parse({ priorityMode: 'weighted', defaultPriority: 7 }),
  ]
  library.materialFolders = [
    { id: 'one', name: 'One', order: 0, createdAt: now.toISOString(), studyPriority: 2 },
    { id: 'two', name: 'Two', order: 1, createdAt: now.toISOString(), studyPriority: 8 },
  ]
  library.sources = [
    source('parent', { folderId: 'one' }),
    source('child', { parentSourceId: 'parent' }),
  ]
  expect(createPriorityResolver(library).source(library.sources[1]!)).toMatchObject({
    value: 2,
    inherited: true,
    from: 'one',
    kind: 'folder',
  })
  library.sources[0]!.folderId = 'two'
  expect(createPriorityResolver(library).source(library.sources[1]!).value).toBe(8)
  library.sources[1]!.studyPriority = 0
  expect(createPriorityResolver(library).source(library.sources[1]!)).toMatchObject({
    value: 0,
    inherited: false,
    from: 'child',
  })
  delete library.sources[1]!.studyPriority
  library.sources[1]!.priority = 'high'
  expect(createPriorityResolver(library).source(library.sources[1]!).value).toBe(1)
  delete library.sources[1]!.priority
  library.sources[1]!.parentSourceId = undefined
  expect(createPriorityResolver(library).source(library.sources[1]!)).toMatchObject({
    value: 7,
    kind: 'default',
  })
})
it('inherits cards through their source unless a note overrides it, then falls back to its deck', () => {
  const library = fixture()
  library.sources = [source('reading', { studyPriority: 3 })]
  library.notes[0]!.excerpt = {
    sourceId: 'reading',
    mediaId: 'media-reading',
    start: 0,
    end: 1,
    quote: 'x',
  }
  library.decks[0]!.studyPriority = 8
  expect(createPriorityResolver(library).card(cardViews(library)[0]!).value).toBe(3)
  library.notes[0]!.studyPriority = 0
  expect(createPriorityResolver(library).card(cardViews(library)[0]!)).toMatchObject({
    value: 0,
    inherited: false,
    kind: 'note',
  })
  delete library.notes[0]!.studyPriority
  delete library.notes[0]!.excerpt
  expect(createPriorityResolver(library).card(cardViews(library)[0]!).value).toBe(8)
})
it('provides deterministic weighted buckets without starving or duplicating low priority entries', () => {
  const entries = Array.from({ length: 90 }, (_, index) => ({ id: index, priority: index % 10 }))
  const ordered = weightedPriorityOrder(entries, (entry) => entry.priority, 5, '2026-10-30')
  expect(ordered).toEqual(
    weightedPriorityOrder(entries, (entry) => entry.priority, 5, '2026-10-30'),
  )
  expect(ordered.slice(0, 9).every((entry) => entry.priority === 0)).toBe(true)
  expect(new Set(ordered.map((entry) => entry.id)).size).toBe(entries.length)
  for (let priority = 0; priority < 10; priority++)
    expect(ordered.filter((entry) => entry.priority === priority)).toEqual(
      entries.filter((entry) => entry.priority === priority),
    )
  const choices = Array.from(
    { length: 400 },
    (_, index) => weightedPriorityOrder([1, 9], (value) => value, 5, String(index))[0],
  )
  expect(choices.filter((value) => value === 1).length).toBeGreaterThan(290)
  expect(choices.filter((value) => value === 1).length).toBeLessThan(375)
  expect(priorityWeight(1) / priorityWeight(9)).toBeCloseTo(5)
})
it('never lets absolute priority bypass dates, quotas, suspension, Inbox or chapter locks', () => {
  const library = fixture()
  library.studySettings = [studySettingsSchema.parse({ priorityMode: 'weighted' })]
  library.notes[0]!.studyPriority = 0
  library.decks[0]!.newLimit = 0
  expect(dueCards(library, now)).toHaveLength(0)
  library.decks[0]!.newLimit = 20
  library.cards[0]!.suspended = true
  expect(dueCards(library, now)).toHaveLength(0)
  library.sources = [
    source('parent'),
    source('first', {
      studySequence: { groupId: 'parent', index: 0, mode: 'sequential', completed: false },
    }),
    source('second', {
      studyPriority: 0,
      studySequence: { groupId: 'parent', index: 1, mode: 'sequential', completed: false },
    }),
    source('future', { studyPriority: 0, queue: { state: 'active', availableOn: '2099-01-01' } }),
  ]
  expect(
    queuedSources(library.sources, 'ready', '2026-10-30', {}, library).map((entry) => entry.id),
  ).toEqual(['first', 'parent'])
})
