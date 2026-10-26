import { describe, expect, it } from 'vitest'
import { inspectPreview, previewScanSchema, type PreviewScan } from './preview'
import { createWorkspaceMarkdown } from './markdown'
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
