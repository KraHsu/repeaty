import { expect, it } from 'vitest'
import { reactive } from 'vue'
import { fixture, input } from './test-fixtures'
import { saveNote } from './model'
import { operationFor } from './operations'
import {
  operationHistory,
  parseOperationHistory,
  rebindOperationHistory,
} from './operation-history'
import { addSource, prepareSource, removeSource } from './sources'

it('detaches nested editor proxies before writing a durable history record', () => {
  const before = fixture()
  const after = reactive(saveNote(before, { ...input, front: 'With image' }))
  after.notes.at(-1)!.frontMedia = ['editor-image']
  const history = parseOperationHistory(
    operationHistory([operationFor(before, after, 'local:test', '修改')!]),
  )
  expect(structuredClone(history)).toEqual(history)
  after.notes.at(-1)!.frontMedia!.push('later-image')
  const note = history.undo[0]!.changes.find((change) => change.store === 'notes')!
    .after as import('./model').Note
  expect(note.frontMedia).toEqual(['editor-image'])
  expect(history.mediaIds).toEqual(['editor-image'])
})

it('round-trips JSON without Blob values and rebinds only session ownership', () => {
  const prepared = prepareSource({ title: 'Original', url: '', format: 'plain', content: 'retain' })
  const before = addSource(fixture(), prepared.source, prepared.asset)
  const entry = operationFor(
    before,
    removeSource(before, prepared.source.id),
    'local:old',
    '删除材料',
  )!
  const history = operationHistory([entry])
  expect(history.mediaIds).toContain(prepared.source.mediaId)
  const reopened = parseOperationHistory(JSON.parse(JSON.stringify(history)))
  const rebound = rebindOperationHistory(reopened, 'local:new')
  expect(rebound.undo[0]!.scope).toBe('local:new')
  expect(rebound.undo[0]!.changes).toEqual(reopened.undo[0]!.changes)
  expect(reopened.undo[0]!.scope).toBe('local:old')
})

it('rejects invalid records, duplicate commands, hidden receipts and missing media references', () => {
  const before = fixture(),
    after = saveNote(before, { ...input, front: 'Added' })
  const entry = operationFor(before, after, 'local:test', '修改')!
  const history = operationHistory([entry])
  expect(() => parseOperationHistory({ ...history, redo: [entry] })).toThrow('Duplicate')
  expect(() => parseOperationHistory(operationHistory(Array(21).fill(entry)))).toThrow()
  expect(() => parseOperationHistory({ ...history, mediaIds: ['unrelated'] })).toThrow(
    'media references',
  )
  for (const change of [
    { ...entry.changes[0]!, id: 'another-record' },
    { ...entry.changes[0]!, keys: ['__proto__'] },
    { ...entry.changes[0]!, store: 'materialReceipts' },
  ])
    expect(() =>
      parseOperationHistory({ ...history, undo: [{ ...entry, changes: [change] }] }),
    ).toThrow()
})
