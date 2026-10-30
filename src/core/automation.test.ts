import { describe, expect, it } from 'vitest'
import { fixture, input, now } from './test-fixtures'
import { saveNote, librarySchema } from './model'
import { addSource, prepareSource } from './sources'
import { addMaterialFolder, moveMaterial } from './material-organization'
import { operationFor, revertOperation } from './operations'
import { reviewCard } from './scheduler'
import {
  AutomationApplySchema,
  AutomationQuerySchema,
  AutomationRequestSchema,
  automationFingerprint,
  canonicalAutomationRequest,
  prepareAutomation,
  queryAutomation,
  type AutomationCommand,
} from './automation'
import { automationReceiptSchema, validateAutomationReceipts } from './automation-data'

const request = (...commands: AutomationCommand[]) => ({
  protocolVersion: 1 as const,
  operationId: 'test-1',
  expectedRevision: 7,
  commands,
})
const prepare = (library: ReturnType<typeof fixture>, ...commands: AutomationCommand[]) =>
  prepareAutomation(library, request(...commands), 7, now)

describe('strict public automation protocol', () => {
  it('does not accept caller-supplied authority or arbitrary fields at any boundary', () => {
    const command = { kind: 'deck.create' as const, input: { name: 'Deck' } }
    expect(
      AutomationRequestSchema.safeParse({ ...request(command), actorId: 'trusted' }).success,
    ).toBe(false)
    expect(
      AutomationRequestSchema.safeParse(
        request({ ...command, input: { name: 'Deck', grant: 'all' } } as never),
      ).success,
    ).toBe(false)
    expect(AutomationQuerySchema.safeParse({ kind: 'library', grant: 'all' }).success).toBe(false)
    expect(
      AutomationApplySchema.safeParse({
        request: request(command),
        fingerprint: 'a'.repeat(64),
        grant: 'all',
      }).success,
    ).toBe(false)
    expect(
      AutomationRequestSchema.safeParse(request({ kind: 'history.undo' }, command)).success,
    ).toBe(false)
  })
  it('canonicalizes object order but binds the operation, revision, content and command order', async () => {
    const a = request({ kind: 'deck.create', input: { name: 'Deck', description: 'Text' } })
    const b = {
      commands: [{ input: { description: 'Text', name: 'Deck' }, kind: 'deck.create' }],
      expectedRevision: 7,
      operationId: 'test-1',
      protocolVersion: 1,
    }
    expect(canonicalAutomationRequest(a)).toBe(canonicalAutomationRequest(b))
    expect(await automationFingerprint(a)).toBe(await automationFingerprint(b))
    expect(await automationFingerprint(a)).not.toBe(
      await automationFingerprint({ ...a, operationId: 'test-2' }),
    )
    expect(await automationFingerprint(a)).not.toBe(
      await automationFingerprint({ ...a, expectedRevision: 8 }),
    )
  })
})

describe('prepare without persistence', () => {
  it('retains original snapshots and assets while editing source body, title and queue', async () => {
    const original = prepareSource(
      { title: 'Before', content: 'old body', url: '', format: 'markdown' },
      now,
    )
    const before = addSource(fixture(), original.source, original.asset)
    const snapshot = structuredClone(before)
    const result = prepare(
      before,
      {
        kind: 'source.patch',
        sourceId: original.source.id,
        versionId: original.source.mediaId,
        patch: { title: 'After', body: 'new body' },
      },
      { kind: 'source.archive', sourceId: original.source.id },
    )
    expect(before).toEqual(snapshot)
    expect(result.assets).toHaveLength(1)
    expect(await result.assets[0]!.blob.text()).toBe('new body')
    expect(result.library.sources[0]).toMatchObject({
      id: original.source.id,
      title: 'After',
      queue: { state: 'archived' },
      versions: [{ mediaId: original.source.mediaId }],
    })
    expect(result.library.media.some((value) => value.id === original.source.mediaId)).toBe(true)
    const restored = prepare(result.library, {
      kind: 'source.restore',
      sourceId: original.source.id,
    })
    expect(restored.library.sources[0]!.queue!.state).toBe('active')
    const operation = operationFor(before, result.library, 'local:test', '修改')!
    expect(revertOperation(result.library, operation)).toEqual(before)
  })
  it('reports indirect child and sibling changes for host permission checks', () => {
    let before = addMaterialFolder(fixture(), 'Parent')
    const parent = before.materialFolders[0]!
    before = addMaterialFolder(before, 'Child', parent.id)
    for (const title of ['a', 'b']) {
      const prepared = prepareSource({ title, content: title, format: 'plain', url: '' }, now)
      before = moveMaterial(addSource(before, prepared.source, prepared.asset), {
        kind: 'source',
        id: prepared.source.id,
        destination: { folderId: parent.id },
      })
    }
    const reordered = prepare(before, {
      kind: 'source.move',
      sourceId: before.sources[1]!.id,
      destination: { folderId: parent.id },
      beforeId: before.sources[0]!.id,
    })
    expect(new Set(reordered.touched.sources)).toEqual(
      new Set(before.sources.map((value) => value.id)),
    )
    const unwrapped = prepare(before, { kind: 'folder.remove', folderId: parent.id })
    expect(new Set(unwrapped.touched.folders)).toEqual(
      new Set(before.materialFolders.map((value) => value.id)),
    )
    expect(new Set(unwrapped.touched.sources)).toEqual(
      new Set(before.sources.map((value) => value.id)),
    )
    expect(unwrapped.library.sources.every((value) => !value.folderId)).toBe(true)
  })
  it('creates valid note variants, applies batch edits and can undo removals with history', () => {
    const base = fixture()
    const before = reviewCard(base, base.cards[0]!.id, 3, now)
    const edited = prepare(
      before,
      { kind: 'note.patch', noteId: before.notes[0]!.id, patch: { front: 'Updated' } },
      { kind: 'note.tags', noteIds: [before.notes[0]!.id], add: ['topic'] },
    )
    expect(edited.library.cards).toEqual(before.cards)
    expect(edited.library.reviews).toEqual(before.reviews)
    expect(edited.library.notes[0]).toMatchObject({
      id: before.notes[0]!.id,
      front: 'Updated',
      tags: ['test', 'topic'],
    })
    const created = prepare(edited.library, {
      kind: 'note.create',
      input: {
        deckId: base.decks[0]!.id,
        front: '{{c1::first}} {{c2::second}}',
        back: '',
        type: 'cloze',
      },
    })
    expect(created.resultIds.cards).toHaveLength(2)
    expect(librarySchema.safeParse(created.library).success).toBe(true)
    const removed = prepare(before, { kind: 'note.remove', noteIds: [before.notes[0]!.id] })
    expect(removed.library.reviews).toHaveLength(0)
    expect(
      revertOperation(
        removed.library,
        operationFor(before, removed.library, 'local:test', '修改')!,
      ),
    ).toEqual(before)
  })
  it('rejects stale revision/body, missing IDs, invalid references and host-only actions without mutating input', () => {
    const before = fixture()
    const frozen = structuredClone(before)
    expect(() =>
      prepareAutomation(before, request({ kind: 'deck.create', input: { name: 'New' } }), 8),
    ).toThrow('library-changed')
    expect(() => prepare(before, { kind: 'note.remove', noteIds: ['missing'] })).toThrow(
      'not-found',
    )
    expect(() =>
      prepare(before, {
        kind: 'note.create',
        input: { ...input, type: 'basic', frontMedia: ['missing'] },
      }),
    ).toThrow('invalid-arguments')
    expect(() => prepare(before, { kind: 'retired.restore', noteId: 'retired' })).toThrow(
      'host-action-required',
    )
    expect(() => prepare(before, { kind: 'checkpoint.restore', checkpointId: 'backup' })).toThrow(
      'host-action-required',
    )
    expect(before).toEqual(frozen)
  })
})

describe('scoped snapshot query primitives', () => {
  it('requires the original revision after the first page, returns detached results and omits private plugin state', () => {
    const before = saveNote(fixture(), { ...input, front: 'second' }, undefined, false, now)
    const first = queryAutomation(before, 9, { kind: 'notes', limit: 1 }) as {
      items: { front: string }[]
      nextOffset: number
    }
    expect(first.nextOffset).toBe(1)
    first.items[0]!.front = 'edited by caller'
    expect(before.notes[0]!.front).not.toBe('edited by caller')
    expect(() => queryAutomation(before, 9, { kind: 'notes', offset: 1 })).toThrow(
      'library-changed',
    )
    expect(() => queryAutomation(before, 10, { kind: 'notes', offset: 1, revision: 9 })).toThrow(
      'library-changed',
    )
    expect(queryAutomation(before, 9, { kind: 'notes', offset: 1, revision: 9 })).toMatchObject({
      total: 2,
      items: [{ front: 'second' }],
    })
    expect(() => queryAutomation(before, 9, { kind: 'source.body', sourceId: 'source' })).toThrow(
      'host-action-required',
    )
  })
})

it('validates immutable, actor-scoped receipts without treating a different actor as a retry', () => {
  const receipt = automationReceiptSchema.parse({
    id: 'receipt',
    actorId: 'actor',
    requestId: 'request',
    operationId: 'undo',
    fingerprint: 'a'.repeat(64),
    createdAt: now.toISOString(),
    result: {
      revision: 8,
      resultIds: { sources: [], folders: [], notes: [], decks: ['deck'], cards: [] },
    },
  })
  const fail = (message: string) => {
    throw new Error(message)
  }
  expect(() =>
    validateAutomationReceipts(
      [receipt],
      [{ ...receipt, result: { ...receipt.result, revision: 9 } }],
      fail,
    ),
  ).toThrow('immutable')
  expect(() =>
    validateAutomationReceipts([], [receipt, { ...receipt, id: 'receipt2' }], fail),
  ).toThrow('Duplicate')
  expect(() =>
    validateAutomationReceipts(
      [],
      [receipt, { ...receipt, id: 'receipt2', actorId: 'another' }],
      fail,
    ),
  ).not.toThrow()
})
