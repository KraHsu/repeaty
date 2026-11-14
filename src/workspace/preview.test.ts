import { describe, expect, it, vi } from 'vitest'
import {
  inspectPreview,
  previewScanSchema,
  createPreviewInspector,
  createPreviewReceiver,
  previewPatch,
  type PreviewScan,
} from './preview'
import { createWorkspaceMarkdown, readWorkspaceMarkdown } from './markdown'
const raw = (front = '问题🙂', id = 'note') =>
  createWorkspaceMarkdown(
    {
      repeaty: { version: 1, kind: 'note', id, type: 'basic', format: 'markdown', deckId: 'deck' },
    },
    { kind: 'note', front, back: '答案' },
  )
const snapshot = (): PreviewScan => ({
  token: crypto.randomUUID(),
  complete: true,
  issues: [],
  accepted: [
    {
      id: 'note',
      path: 'notes/original.md',
      raw: raw(),
      cards: [{ id: 'card', variant: 'forward', lifecycle: 'active' }],
    },
  ],
  observations: [],
})
describe('desktop scan projection', () => {
  it('parses unchanged Markdown once while still checking duplicate identities across the whole snapshot', () => {
    const parse = vi.fn(readWorkspaceMarkdown),
      inspect = createPreviewInspector(parse),
      scan = snapshot()
    scan.observations = [{ path: 'notes/original.md', raw: raw() }]
    expect(inspect(scan)[0]!.status).toBe('unchanged')
    expect(parse).toHaveBeenCalledTimes(1)
    inspect(structuredClone(scan))
    expect(parse).toHaveBeenCalledTimes(1)
    scan.observations.push({ path: 'notes/copy.md', raw: raw('second copy') })
    expect(inspect(scan).every((file) => file.status === 'conflict')).toBe(true)
    expect(parse).toHaveBeenCalledTimes(2)
  })
  it('transfers only changed bodies to the worker and rejects another session’s delta', () => {
    const receiver = createPreviewReceiver(),
      before = snapshot()
    before.observations = [{ path: 'notes/original.md', raw: raw() }]
    receiver({ scan: before })
    const after = structuredClone(before)
    after.observations.push({ path: 'notes/new.md', raw: raw('New', 'other-note') })
    const patch = previewPatch(before, after)
    expect(patch.accepted).toEqual([])
    expect(patch.observations.map((entry) => entry.path)).toEqual(['notes/new.md'])
    expect(receiver({ patch })).toEqual(inspectPreview(after))
    expect(() => receiver({ patch: { ...patch, token: crypto.randomUUID() } })).toThrow(
      'invalid-scan-session',
    )
    const removed = { ...after, observations: after.observations.slice(1) }
    expect(receiver({ patch: previewPatch(after, removed) })).toEqual(inspectPreview(removed))
  })
  it('uses stable identities for moves and keeps unchanged card mappings', () => {
    const scan = snapshot()
    scan.observations = [{ path: 'notes/中文/new.md', raw: raw('外部修改') }]
    const [change] = inspectPreview(scan)
    expect(change?.status).toBe('renamed-modified')
    expect(change?.previousPath).toBe('notes/original.md')
    expect(change?.variants?.keep[0]?.cardId).toBe('card')
    expect(scan.accepted[0]?.raw).toBe(raw())
  })
  it('reports duplicate identities without choosing a winner or treating the old path as deleted', () => {
    const scan = snapshot()
    scan.observations = [
      { path: 'notes/a.md', raw: raw() },
      { path: 'notes/b.md', raw: raw() },
    ]
    expect(inspectPreview(scan).map((file) => file.status)).toEqual(['conflict', 'conflict'])
  })
  it('only reports missing files after complete scans and never considers a failed read deleted', () => {
    const scan = snapshot()
    scan.complete = false
    expect(inspectPreview(scan)).toEqual([])
    scan.complete = true
    expect(inspectPreview(scan)[0]?.status).toBe('missing')
    scan.observations = [{ path: 'notes/original.md', error: 'permission-denied' }]
    expect(inspectPreview(scan).map((file) => file.status)).toEqual(['pending'])
  })
  it('rejects malformed native snapshots and invalid accepted identity baselines', () => {
    const scan = snapshot()
    scan.accepted[0]!.id = 'another'
    expect(() => inspectPreview(scan)).toThrow('invalid-accepted-manifest')
    expect(() => previewScanSchema.parse({ ...snapshot(), token: 'path-as-token' })).toThrow()
  })
  it('preserves raw HTML and incomplete files without executing or accepting anything', () => {
    const scan = snapshot()
    scan.observations = [
      { path: 'notes/original.md', raw: '---\nrepeaty:' },
      { path: 'sources/raw.md', raw: '<script>throw Error("do not run")</script>' },
    ]
    const changes = inspectPreview(scan)
    expect(changes[0]?.status).toBe('pending')
    expect(changes[1]?.status).toBe('unmanaged')
    expect(scan.observations[1]?.raw).toContain('<script>')
  })
})
