import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { fixture, now } from '../core/test-fixtures'
import { emptyLibrary, recordSchemas, saveNote, type Library } from '../core/model'
import { reviewCard, undoReview } from '../core/scheduler'
import { planSync } from './merge'
import {
  canonicalSyncValue,
  parseSyncEvents,
  SYNC_LIMITS,
  syncFingerprint,
  type SyncChange,
  type SyncClock,
  type SyncEvent,
  type SyncSnapshot,
} from './protocol'
import {
  cloneSyncSnapshot,
  libraryFromSnapshot,
  snapshotFromLibrary,
  snapshotToRetired,
} from './projection'

const clean = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
function event(
  deviceId: string,
  sequence: number,
  changes: SyncChange[],
  clock: SyncClock = {},
): SyncEvent {
  return clean({
    protocol: 1,
    groupId: 'test-group',
    id: `${deviceId}:${sequence}`,
    deviceId,
    sequence,
    clock: { ...clock, [deviceId]: sequence - 1 },
    changes,
  })
}
function difference(before: Library, after: Library): SyncChange[] {
  const changes: SyncChange[] = []
  for (const store of Object.keys(recordSchemas) as (keyof typeof recordSchemas)[]) {
    const previous = new Map(before[store].map((value) => [value.id, clean(value)]))
    for (const [position, value] of after[store].entries()) {
      const old = previous.get(value.id) ?? null,
        next = clean(value)
      if (canonicalSyncValue(old) !== canonicalSyncValue(next))
        changes.push({ store, id: value.id, before: old, after: next, position })
      previous.delete(value.id)
    }
    for (const [id, value] of previous) changes.push({ store, id, before: value, after: null })
  }
  return changes
}
const run = (snapshot: SyncSnapshot, events: SyncEvent[], appliedClock: SyncClock = {}) =>
  planSync({ snapshot, events, appliedClock, groupId: 'test-group' })
const changeNote = (library: Library, changes: Partial<Library['notes'][number]>): Library => ({
  ...library,
  notes: library.notes.map((note) => ({ ...note, ...changes })),
})

describe('sync envelope validation', () => {
  it('uses canonical SHA-256 independent of object order and Unicode', () => {
    const value = { b: ['中文', 5], a: 1 }
    expect(syncFingerprint(value)).toBe(
      createHash('sha256').update(canonicalSyncValue(value)).digest('hex'),
    )
    expect(syncFingerprint(value)).toBe(syncFingerprint({ a: 1, b: ['中文', 5] }))
  })
  it('deduplicates equivalent events and rejects equivocation within a batch', () => {
    const first = event('a', 1, [])
    expect(parseSyncEvents([first, clean(first)])).toHaveLength(1)
    expect(() =>
      parseSyncEvents([
        first,
        {
          ...first,
          changes: [{ store: 'values:settings', id: 'plugin:x', before: null, after: 1 }],
        },
      ]),
    ).toThrow('sync-event-identity-conflict')
  })
  it.each([
    { protocol: 2 },
    { id: 'a:2' },
    { sequence: 0 },
    { clock: { a: 2 } },
    { clock: { a: -1 } },
    { extra: true },
    { deviceId: 'device:with:colon' },
  ])('rejects invalid envelope metadata %j', (patch) => {
    expect(() => parseSyncEvents([{ ...event('a', 1, []), ...patch }])).toThrow()
  })
  it('enforces group, count, causal device and per-transaction identity boundaries', () => {
    expect(() => parseSyncEvents([event('a', 1, [])], 'other')).toThrow('sync-wrong-group')
    expect(() =>
      parseSyncEvents(Array.from({ length: SYNC_LIMITS.events + 1 }, () => event('a', 1, []))),
    ).toThrow('sync-batch-limit')
    const change = { store: 'values:settings', id: 'plugin:theme', before: null, after: 'green' }
    expect(() => parseSyncEvents([event('a', 1, [change, change])])).toThrow(
      'sync-duplicate-change',
    )
    expect(() =>
      parseSyncEvents([event('a', 1, [{ ...change, store: 'values:leetcode' }])]),
    ).toThrow('sync-unknown-store')
    expect(() => parseSyncEvents([event('a', 1, [{ ...change, after: undefined }])])).toThrow()
    expect(() =>
      parseSyncEvents([event('a', 1, [{ ...change, after: null, position: 0 }])]),
    ).toThrow('sync-invalid-change')
  })
  it('rejects cycles and non JSON payloads before projection', () => {
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(() => canonicalSyncValue(cyclic)).toThrow('sync-invalid-json')
    expect(() => canonicalSyncValue({ value: Number.NaN })).toThrow('sync-invalid-json')
    expect(() => canonicalSyncValue(new Date())).toThrow('sync-invalid-json')
  })
  it('requires an explicit own-device predecessor and rejects prototype device clocks', () => {
    expect(() => parseSyncEvents([{ ...event('a', 1, []), clock: {} }])).toThrow(
      'sync-invalid-event-clock',
    )
    for (const deviceId of ['__proto__', 'constructor', 'prototype']) {
      const clock = JSON.parse(`{"${deviceId}":0}`) as SyncClock
      expect(() =>
        parseSyncEvents([{ ...event('a', 1, []), deviceId, id: `${deviceId}:1`, clock }]),
      ).toThrow()
    }
  })
  it('treats inherited clock property names as absent rather than already applied', () => {
    const result = run(snapshotFromLibrary(fixture()), [event('toString', 1, [])])
    expect(result.appliedIds).toEqual(['toString:1'])
    expect(result.clock.toString).toBe(1)
  })
  it('rejects device preferences in the settings namespace while permitting plugin configuration', () => {
    expect(() =>
      parseSyncEvents([
        event('a', 1, [{ store: 'values:settings', id: 'theme', before: null, after: 'green' }]),
      ]),
    ).toThrow('sync-nonportable-value')
    const snapshot = snapshotFromLibrary(fixture())
    snapshot.values.settings = { theme: { position: 0, value: 'green' } }
    expect(() => run(snapshot, [])).toThrow('sync-nonportable-value')
  })
  it('handles prototype-looking record IDs as inert own properties without polluting objects', () => {
    const base = fixture()
    base.decks[0]!.id = '__proto__'
    base.notes[0]!.id = 'constructor'
    base.notes[0]!.deckId = '__proto__'
    base.cards[0]!.id = 'prototype'
    base.cards[0]!.noteId = 'constructor'
    const edited = changeNote(base, { front: 'safe change' })
    const changes = difference(base, edited)
    for (const id of ['__proto__', 'constructor', 'prototype'])
      changes.push({
        store: 'values:plugin:sample',
        id,
        before: null,
        after: JSON.parse(
          '{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}}}',
        ),
      })
    const plan = run(snapshotFromLibrary(base), [event('safe-device', 1, changes)])
    expect(plan.blocked).toBe(false)
    expect(libraryFromSnapshot(plan.snapshot).notes[0]!.front).toBe('safe change')
    for (const id of ['__proto__', 'constructor', 'prototype'])
      expect(Object.hasOwn(plan.snapshot.values['plugin:sample']!, id)).toBe(true)
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    expect(Object.getPrototypeOf(plan.snapshot.values['plugin:sample']!)).toBe(Object.prototype)
  })
  it('does not renumber unordered native values and retirement tables or invent resolution events', () => {
    const snapshot = snapshotFromLibrary(fixture())
    snapshot.values['plugin:sample'] = {
      a: { position: 0, value: 1 },
      b: { position: 0, value: 2 },
    }
    const result = run(snapshot, [])
    expect(result.resolutionChanges).toEqual([])
    expect(result.snapshot.values).toEqual(snapshot.values)
  })
})

describe('causal planning and content conflict resolution', () => {
  it('applies unordered dependencies and duplicate delivery exactly once without mutating inputs', () => {
    const base = fixture(),
      edited = changeNote(base, { front: 'first' }),
      again = changeNote(edited, { front: 'second' })
    const a = event('a', 1, difference(base, edited)),
      b = event('a', 2, difference(edited, again))
    const snapshot = snapshotFromLibrary(base),
      saved = clean({ snapshot, events: [b, a] })
    const plan = run(snapshot, [b, a, a])
    expect(plan.blocked).toBe(false)
    expect(plan.appliedIds).toEqual(['a:1', 'a:2'])
    expect(libraryFromSnapshot(plan.snapshot).notes[0]!.front).toBe('second')
    expect({ snapshot, events: [b, a] }).toEqual(saved)
    expect(run(plan.snapshot, [a, b], plan.clock).appliedIds).toEqual([])
  })
  it('returns missing dependencies and cyclic dependencies explicitly without advancing their clocks', () => {
    const snapshot = snapshotFromLibrary(fixture())
    const pending = run(snapshot, [event('a', 2, [], { b: 3 })])
    expect(pending.pending).toEqual([{ eventId: 'a:2', missing: { a: 1, b: 3 } }])
    expect(pending.clock).toEqual({})
    const cycle = run(snapshot, [event('a', 1, [], { b: 1 }), event('b', 1, [], { a: 1 })])
    expect(cycle.pending).toHaveLength(2)
    expect(cycle.appliedIds).toEqual([])
  })
  it('merges independent fields in either delivery direction, including changed metadata', () => {
    const base = fixture()
    const left = changeNote(base, { front: 'left', updatedAt: '2026-10-18T00:00:00.000Z' })
    const right = changeNote(base, { back: 'right', updatedAt: '2026-10-19T00:00:00.000Z' })
    const a = event('a', 1, difference(base, left)),
      b = event('b', 1, difference(base, right))
    const fromA = run(snapshotFromLibrary(left), [b], { a: 1 })
    const fromB = run(snapshotFromLibrary(right), [a], { b: 1 })
    expect(fromA.blocked).toBe(false)
    expect(fromA.snapshot).toEqual(fromB.snapshot)
    expect(libraryFromSnapshot(fromA.snapshot).notes[0]).toMatchObject({
      front: 'left',
      back: 'right',
    })
  })
  it('produces direction-independent conflict identity and blocks the entire apply until chosen', () => {
    const base = fixture(),
      left = changeNote(base, { front: 'left' }),
      right = changeNote(base, { front: 'right' })
    const a = event('a', 1, difference(base, left)),
      b = event('b', 1, difference(base, right))
    const snapshot = snapshotFromLibrary(left)
    const input = { snapshot, events: [b], appliedClock: { a: 1 } }
    const plan = planSync(input)
    const reverse = run(snapshotFromLibrary(right), [a], { b: 1 })
    expect(plan.conflicts[0]!.id).toBe(reverse.conflicts[0]!.id)
    expect(plan.blocked).toBe(true)
    expect(plan.snapshot).toEqual(snapshot)
    expect(plan.clock).toEqual({ a: 1 })
    expect(plan.appliedIds).toEqual([])
    const resolved = planSync(input, { [plan.conflicts[0]!.id]: 'remote' })
    expect(resolved.blocked).toBe(false)
    expect(resolved.clock).toEqual({ a: 1, b: 1 })
    expect(libraryFromSnapshot(resolved.snapshot).notes[0]!.front).toBe('right')
    expect(() => planSync(input, { obsolete: 'remote' })).toThrow('sync-stale-choice')
  })
  it.each(['local', 'remote'] as const)(
    'propagates a %s choice through a causal resolution event to the other branch',
    (choice) => {
      const base = fixture(),
        left = changeNote(base, { front: 'left' }),
        right = changeNote(base, { front: 'right' })
      const a = event('a', 1, difference(base, left)),
        b = event('b', 1, difference(base, right))
      const input = { snapshot: snapshotFromLibrary(left), events: [b], appliedClock: { a: 1 } }
      const conflict = planSync(input).conflicts[0]!
      const selected = planSync(input, { [conflict.id]: choice })
      expect(selected.resolutionChanges.some((change) => change.store === 'notes')).toBe(true)
      const resolution = event('a', 2, selected.resolutionChanges, selected.clock)
      const other = run(snapshotFromLibrary(right), [resolution, a], { b: 1 })
      expect(other.blocked).toBe(false)
      expect(other.conflicts).toEqual([])
      expect(other.snapshot).toEqual(selected.snapshot)
      expect(other.clock).toEqual({ a: 2, b: 1 })
    },
  )
  it('does not use a resolution to overwrite local edits outside its observed clock', () => {
    const base = fixture(),
      left = changeNote(base, { front: 'left' }),
      right = changeNote(base, { front: 'right' })
    const a = event('a', 1, difference(base, left)),
      b = event('b', 1, difference(base, right))
    const input = { snapshot: snapshotFromLibrary(left), events: [b], appliedClock: { a: 1 } }
    const conflict = planSync(input).conflicts[0]!
    const selected = planSync(input, { [conflict.id]: 'local' })
    const resolution = event('a', 2, selected.resolutionChanges, selected.clock)
    const newer = changeNote(right, { front: 'unseen newer edit' })
    const other = run(snapshotFromLibrary(newer), [resolution, a], { b: 2 })
    expect(other.blocked).toBe(true)
    expect(libraryFromSnapshot(other.snapshot).notes[0]!.front).toBe('unseen newer edit')
  })
  it('emits a merged record relative to the last remote value and can relay it without repeating a local edit', () => {
    const base = fixture(),
      left = changeNote(base, { front: 'left' }),
      right = changeNote(base, { back: 'right' })
    const a = event('a', 1, difference(base, left)),
      b = event('b', 1, difference(base, right))
    const merged = run(snapshotFromLibrary(left), [b], { a: 1 })
    const resolution = event('a', 2, merged.resolutionChanges, merged.clock)
    const other = run(snapshotFromLibrary(right), [resolution, a], { b: 1 })
    expect(other.blocked).toBe(false)
    expect(other.snapshot).toEqual(merged.snapshot)
    const note = merged.resolutionChanges.find((change) => change.store === 'notes')!
    expect(note.before).toEqual(clean(right.notes[0]))
    expect(note.after).toMatchObject({ front: 'left', back: 'right' })
  })
  it('treats plugin data and opaque values as atomic documents, not recursive JSON merges', () => {
    const base = fixture({
      type: 'plugin',
      plugin: { id: 'example', version: 1, data: { a: 0, b: 0 } },
    })
    const left = changeNote(base, { plugin: { id: 'example', version: 1, data: { a: 1, b: 0 } } })
    const right = changeNote(base, { plugin: { id: 'example', version: 1, data: { a: 0, b: 1 } } })
    expect(
      run(snapshotFromLibrary(left), [event('b', 1, difference(base, right))], { a: 1 })
        .conflicts[0],
    ).toMatchObject({ path: 'plugin', kind: 'content' })
    const snapshot = snapshotFromLibrary(fixture())
    snapshot.values['plugin:example'] = { data: { position: 0, value: { a: 1, b: 0 } } }
    const result = run(snapshot, [
      event('b', 1, [
        {
          store: 'values:plugin:example',
          id: 'data',
          before: { a: 0, b: 0 },
          after: { a: 0, b: 1 },
        },
      ]),
    ])
    expect(result.blocked).toBe(true)
    expect(result.conflicts[0]!.path).toBe('')
  })
  it('blocks unsafe note variant unions and does not pretend a record-level choice repairs structure', () => {
    const base = fixture(),
      id = base.notes[0]!.id
    const left = saveNote(base, { ...base.notes[0]!, type: 'reversed' }, id, false, now)
    const right = saveNote(base, { ...base.notes[0]!, type: 'reversed' }, id, false, now)
    const result = run(snapshotFromLibrary(left), [event('b', 1, difference(base, right))], {
      a: 1,
    })
    expect(result.blocked).toBe(true)
    expect(
      result.conflicts.some((conflict) => conflict.kind === 'structure' && !conflict.resolvable),
    ).toBe(true)
    expect(result.snapshot).toEqual(snapshotFromLibrary(left))
  })
  it('blocks delete/edit conflicts and dangling references atomically', () => {
    const base = fixture(),
      edited = changeNote(base, { front: 'preserve me' })
    const removal = event('b', 1, [
      { store: 'notes', id: base.notes[0]!.id, before: clean(base.notes[0]!), after: null },
    ])
    const input = {
      snapshot: snapshotFromLibrary(edited),
      events: [removal],
      appliedClock: { a: 1 },
    }
    const plan = planSync(input)
    expect(plan.conflicts[0]!.kind).toBe('delete-edit')
    const resolve = planSync(input, { [plan.conflicts[0]!.id]: 'remote' })
    expect(resolve.blocked).toBe(true)
    expect(resolve.conflicts.some((conflict) => conflict.kind === 'structure')).toBe(true)
  })
})

describe('ratings, undo, retirement and complete history', () => {
  it('preserves both independent same-time scores and selects an actual FSRS schedule explicitly', () => {
    const base = fixture(),
      cardId = base.cards[0]!.id
    const left = reviewCard(base, cardId, 1, now),
      right = reviewCard(base, cardId, 4, now)
    const input = {
      snapshot: snapshotFromLibrary(left),
      events: [event('b', 1, difference(base, right))],
      appliedClock: { a: 1 },
    }
    const plan = planSync(input)
    expect(plan.blocked).toBe(true)
    const schedule = plan.conflicts.find((conflict) => conflict.kind === 'schedule')!
    expect(schedule).toBeDefined()
    expect(libraryFromSnapshot(plan.proposedSnapshot).reviews).toHaveLength(2)
    const resolved = planSync(input, { [schedule.id]: 'remote' })
    expect(resolved.blocked).toBe(false)
    const library = libraryFromSnapshot(resolved.snapshot)
    expect(library.reviews.map((review) => review.id).sort()).toEqual(
      [left.reviews[0]!.id, right.reviews[0]!.id].sort(),
    )
    expect(library.cards[0]!.schedule).toEqual(right.cards[0]!.schedule)
  })
  it('never coalesces two identical ratings with different review IDs', () => {
    const base = fixture(),
      cardId = base.cards[0]!.id
    const left = reviewCard(base, cardId, 3, now),
      right = reviewCard(base, cardId, 3, now)
    const result = run(snapshotFromLibrary(left), [event('b', 1, difference(base, right))], {
      a: 1,
    })
    expect(result.blocked).toBe(false)
    expect(libraryFromSnapshot(result.snapshot).reviews).toHaveLength(2)
  })
  it('applies out-of-order undo and redo without replaying FSRS or resurrecting an old delivery', () => {
    const base = fixture(),
      scored = reviewCard(base, base.cards[0]!.id, 3, now),
      undone = undoReview(scored)
    const a = event('a', 1, difference(base, scored)),
      undo = event('a', 2, difference(scored, undone)),
      redo = event('a', 3, difference(undone, scored))
    const saved = clean([a, undo, redo])
    const result = run(snapshotFromLibrary(base), [undo, a])
    expect(result.blocked).toBe(false)
    expect(libraryFromSnapshot(result.snapshot).reviews).toHaveLength(0)
    expect(run(result.snapshot, [a], result.clock).snapshot).toEqual(result.snapshot)
    const restored = run(result.snapshot, [redo], result.clock)
    expect(libraryFromSnapshot(restored.snapshot).cards[0]!.schedule).toEqual(
      scored.cards[0]!.schedule,
    )
    expect([a, undo, redo]).toEqual(saved)
  })
  it('keeps another device score when one device undoes its own score', () => {
    const base = fixture(),
      cardId = base.cards[0]!.id
    const left = reviewCard(base, cardId, 1, now),
      right = reviewCard(base, cardId, 4, now)
    const first = run(snapshotFromLibrary(base), [event('a', 1, difference(base, left))])
    const undone = run(
      first.snapshot,
      [event('a', 2, difference(left, undoReview(left)))],
      first.clock,
    )
    const merged = run(undone.snapshot, [event('b', 1, difference(base, right))], undone.clock)
    expect(merged.blocked).toBe(false)
    expect(libraryFromSnapshot(merged.snapshot).reviews.map((review) => review.id)).toEqual([
      right.reviews[0]!.id,
    ])
  })
  it('does not recompute schedule or historical studyDay under another timezone', () => {
    const original = process.env.TZ
    try {
      const base = fixture(),
        scored = reviewCard(base, base.cards[0]!.id, 3, now)
      const input = [event('a', 1, difference(base, scored))]
      process.env.TZ = 'America/New_York'
      const a = run(snapshotFromLibrary(base), input)
      process.env.TZ = 'Asia/Shanghai'
      const b = run(snapshotFromLibrary(base), input)
      expect(a.snapshot).toEqual(b.snapshot)
      expect(libraryFromSnapshot(a.snapshot).cards[0]!.schedule).toEqual(scored.cards[0]!.schedule)
    } finally {
      if (original === undefined) delete process.env.TZ
      else process.env.TZ = original
    }
  })
  it('routes ratings of retired cards into retained history without resurrecting the note', () => {
    const base = fixture(),
      card = base.cards[0]!,
      note = base.notes[0]!
    const snapshot = snapshotFromLibrary({ ...base, notes: [], cards: [] })
    snapshot.retired = {
      notes: { [note.id]: { position: 0, value: clean(note) } },
      cards: { [card.id]: { position: 0, value: clean(card) } },
    }
    const scored = reviewCard(base, card.id, 3, now)
    const result = run(snapshot, [event('b', 1, difference(base, scored))])
    expect(result.blocked).toBe(false)
    expect(libraryFromSnapshot(result.snapshot).notes).toHaveLength(0)
    const retired = snapshotToRetired(result.snapshot)
    expect(retired[0]!.reviews[0]!.id).toBe(scored.reviews[0]!.id)
    expect(retired[0]!.cards[0]!.schedule).toEqual(scored.cards[0]!.schedule)
  })
  it('requires document and code bodies for portable retirement and preserves full histories', () => {
    const base = fixture(),
      note = base.notes[0]!,
      card = base.cards[0]!
    const snapshot = snapshotFromLibrary({ ...base, notes: [], cards: [] })
    const hash = 'a'.repeat(64)
    const practice = {
      id: 'practice',
      cardId: card.id,
      contentRevision: 'v1',
      startedAt: now.toISOString(),
      question: {
        front: 'Question',
        back: 'Answer',
        format: 'plain',
        plugin: { id: 'example', version: 1, data: {} },
      },
    }
    const attempt = {
      id: 'attempt',
      practiceId: 'practice',
      submittedAt: now.toISOString(),
      updatedAt: now.toISOString(),
      language: 'python3',
      code: 'print("完整代码")',
      elapsedMs: 5,
      status: 'failed',
    }
    snapshot.retired = {
      notes: { [note.id]: { position: 0, value: clean(note) } },
      cards: { [card.id]: { position: 0, value: clean(card) } },
      documents: {
        [note.id]: { position: 0, value: { id: note.id, kind: 'note', path: 'notes/a.md', hash } },
      },
      practices: { practice: { position: 0, value: practice } },
      attempts: { attempt: { position: 0, value: attempt } },
    }
    expect(() => snapshotToRetired(snapshot)).toThrow('sync-retired-document-body-required')
    const retired = snapshotToRetired(snapshot, { [hash]: 'original Markdown' })
    expect(retired[0]!.attempts[0]).toMatchObject({ code: attempt.code })
    expect(retired[0]!.document!.raw).toBe('original Markdown')
    const compact = cloneSyncSnapshot(snapshot)
    delete (compact.retired.attempts!.attempt!.value as Record<string, unknown>).code
    expect(() => snapshotToRetired(compact, { [hash]: 'original Markdown' })).toThrow(
      'sync-retired-attempt-body-required',
    )
  })
  it('can apply a dependency-complete baseline made of multiple events atomically', () => {
    const base = fixture(),
      all = difference(emptyLibrary(), base)
    const notes = all.filter((change) => change.store !== 'decks'),
      decks = all.filter((change) => change.store === 'decks')
    const a = event('a', 1, notes),
      b = event('a', 2, decks)
    expect(run(snapshotFromLibrary(emptyLibrary()), [a]).blocked).toBe(true)
    const complete = run(snapshotFromLibrary(emptyLibrary()), [b, a])
    expect(complete.blocked).toBe(false)
    expect(libraryFromSnapshot(complete.snapshot)).toEqual(clean(base))
  })
})
