import { afterEach, expect, it, vi } from 'vitest'
import { createWorkspaceMonitor } from './workspace-monitor'
import { fixture } from '../core/test-fixtures'
import { createWorkspaceMarkdown } from '../workspace/markdown'
import { createPreviewInspector } from '../workspace/preview'
import type { NativeApi } from './workspaces'
const monitors: ReturnType<typeof createWorkspaceMonitor>[] = []
afterEach(() => {
  monitors.splice(0).forEach((monitor) => monitor.dispose())
  vi.restoreAllMocks()
})
function example() {
  const library = fixture(),
    note = library.notes[0]!
  const raw = createWorkspaceMarkdown(
    {
      repeaty: {
        version: 1,
        kind: 'note',
        id: note.id,
        deckId: note.deckId,
        format: 'plain',
        type: note.type,
      },
    },
    { kind: 'note', front: note.front, back: note.back },
  )
  const doc = { kind: 'note' as const, id: note.id, path: 'notes/card.md', hash: 'a', raw }
  const scan = {
    accepted: [doc],
    working: [{ path: doc.path, hash: doc.hash, raw }],
    bindings: [] as { kind: 'note'; id: string; media: { path: string; hash: string }[] }[],
    retired: [],
    retiredCount: 0,
    attention: [],
    scanHash: 'full-hash',
  }
  const native = vi.fn(async (_command: string, args?: Record<string, unknown>) => {
    const request = args!.request as { type: string; paths?: string[] }
    if (request.type === 'inspect-assets')
      return request.paths!.map((path) => ({ path, hash: 'asset' }))
    return scan
  })
  const inspect = createPreviewInspector(),
    inspector = {
      inspect: vi.fn(async (scan: Parameters<typeof inspect>[0]) => inspect(scan)),
      dispose: vi.fn(),
    }
  const active = { id: crypto.randomUUID(), token: crypto.randomUUID(), path: '/workspace' }
  const monitor = createWorkspaceMonitor(active, () => library, native as NativeApi, inspector)
  monitors.push(monitor)
  return { library, doc, scan, native, inspector, monitor }
}
const idle = (monitor: ReturnType<typeof createWorkspaceMonitor>) =>
  vi.waitFor(() => expect(monitor.checking.value).toBe(false))

it('merges changed files, detects a duplicate identity, and retains the accepted learning library', async () => {
  const { monitor, library, native, doc } = example()
  const before = structuredClone(library)
  await monitor.refresh()
  await idle(monitor)
  expect(monitor.pendingCount.value).toBe(0)
  native.mockResolvedValueOnce({
    full: false,
    prefixes: ['notes/copy.md'],
    accepted: [],
    removed: [],
    working: [{ path: 'notes/copy.md', hash: 'a', raw: doc.raw }],
    bindings: [],
    attention: [],
  } as never)
  monitor.receive({ paths: ['notes/copy.md'], full: false, available: true })
  await vi.waitFor(() => expect(monitor.pendingCount.value).toBe(2))
  expect(monitor.changes.value.every((file) => file.status === 'conflict')).toBe(true)
  expect(library).toEqual(before)
  const request = native.mock.calls.at(-1)![1]!.request as { full?: boolean; paths: string[] }
  expect(request.full).toBeUndefined()
  expect(request.paths).toEqual(['notes/copy.md'])
})
it('does not classify or read the whole folder for self writes and attachment-only events', async () => {
  const { monitor, native, doc, scan, inspector } = example()
  scan.bindings = [{ kind: 'note', id: doc.id, media: [{ path: 'assets/a.png', hash: 'asset' }] }]
  await monitor.refresh()
  await vi.waitFor(() => expect(native.mock.calls.length).toBe(2))
  await idle(monitor)
  expect(monitor.pendingCount.value).toBe(0)
  native.mockResolvedValueOnce({
    full: false,
    prefixes: [doc.path],
    accepted: [doc],
    removed: [],
    working: [{ path: doc.path, hash: doc.hash, raw: doc.raw }],
    bindings: scan.bindings,
    attention: [],
  } as never)
  monitor.receive({ paths: [doc.path], full: false, available: true })
  await vi.waitFor(() => expect(native.mock.calls.length).toBe(3))
  await idle(monitor)
  expect(inspector.inspect).toHaveBeenCalledTimes(1)
  native.mockResolvedValueOnce([{ path: 'assets/a.png', hash: 'replacement' }] as never)
  monitor.receive({ paths: ['assets/a.png'], full: false, available: true })
  await vi.waitFor(() => expect(monitor.pendingCount.value).toBe(1))
  expect(monitor.changes.value[0]!.reason).toBe('media-changed')
  expect(inspector.inspect).toHaveBeenCalledTimes(1)
  expect((native.mock.calls.at(-1)![1]!.request as { type: string }).type).toBe('inspect-assets')
})
it('preserves a valid baseline on read failures and recovers with a full check', async () => {
  const { monitor, native } = example()
  await monitor.refresh()
  const before = monitor.snapshot.value
  native.mockRejectedValueOnce(Error('unsafe-file'))
  await expect(monitor.refresh()).rejects.toThrow('unsafe-file')
  expect(monitor.snapshot.value).toBe(before)
  expect(monitor.error.value).toBeInstanceOf(Error)
  await monitor.refresh()
  expect(monitor.error.value).toBe('')
})
it('ignores late reads after closing the workspace and settles pending refreshes', async () => {
  const { monitor, native, scan, inspector } = example()
  let finish!: (value: typeof scan) => void
  native.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  const refreshing = monitor.refresh()
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
  monitor.dispose()
  finish(scan)
  await refreshing
  expect(monitor.snapshot.value).toBeUndefined()
  expect(inspector.dispose).toHaveBeenCalledOnce()
})
