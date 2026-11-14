import { beforeEach, describe, it, expect, vi } from 'vitest'
import type { MaterialCommandContext } from '@repeaty/plugin-api'
import { materials } from '../test/plugin-api'
import { imageData, source } from '../test/fixtures'
import { frozenMaterial, prepareNote, saveVisual } from './workflow'
const context = (): MaterialCommandContext => ({
  sourceId: 'source',
  workspaceScope: 'scope',
  expectedRevision: 2,
  operationId: 'open',
  signal: new AbortController().signal,
  progress() {},
  onCleanup() {},
  yield: async () => {},
})
beforeEach(() => {
  vi.clearAllMocks()
  materials.snapshot.mockReturnValue({
    workspaceScope: 'scope',
    revision: 4,
    sources: [source],
    decks: [{ id: 'deck', name: '测试' }],
  })
  materials.get.mockResolvedValue({ material: source, text: 'cell.png' })
  materials.createNote.mockResolvedValue({ noteId: 'note', revision: 5 })
})
describe('host-owned image/formula transactions', () => {
  it('captures immutable originals and commits stable variants through one public mutation', async () => {
    const ctx = context()
    expect((await frozenMaterial(ctx)).material).toEqual(source)
    expect(materials.get).toHaveBeenCalledWith('source', 'version-old')
    const prepared = prepareNote(
      { deckId: 'deck', front: 'question', back: 'original', tags: [] },
      imageData(),
      { sourceId: source.id, versionId: source.versionId },
      'cell.png',
    )
    await saveVisual(ctx, prepared, 'op')
    expect(materials.createNote).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedRevision: 4,
        operationId: 'op',
        sourceId: 'source',
        selection: {
          text: 'cell.png',
          projection: { start: 0, end: 8 },
          locator: expect.objectContaining({ kind: 'image', versionId: 'version-old', x: 0.1 }),
        },
        note: expect.objectContaining({
          plugin: expect.objectContaining({ variants: ['region-a', 'region-b'] }),
        }),
      }),
    )
  })
  it('blocks late reads and writes after library change, cancellation or missing deck', async () => {
    const ctx = context()
    materials.get.mockImplementation(async () => {
      materials.snapshot.mockReturnValue({ workspaceScope: 'new', revision: 9 })
      return { material: source, text: 'cell.png' }
    })
    await expect(frozenMaterial(ctx)).rejects.toThrow('学习库')
    expect(materials.createNote).not.toHaveBeenCalled()
    const aborted = context()
    Object.assign(aborted, { signal: AbortSignal.abort() })
    await expect(frozenMaterial(aborted)).rejects.toThrow()
  })
})
