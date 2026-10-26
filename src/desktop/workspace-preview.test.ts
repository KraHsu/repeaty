import { describe, expect, it, vi } from 'vitest'
import { createWorkspacePreview, type PreviewApi } from './workspace-preview'
import { inspectPreview, type PreviewStatus } from '../workspace/preview'
vi.mock('./workspace-inspector', () => ({
  createInspector: () => ({
    inspect: async (scan: import('../workspace/preview').PreviewScan) => inspectPreview(scan),
    dispose() {},
  }),
}))
const status = (): PreviewStatus => ({
  epoch: crypto.randomUUID(),
  active: { id: crypto.randomUUID(), token: crypto.randomUUID(), path: '/chosen' },
  recent: [],
  restore_error: null,
})
const scan = (token: string) => ({
  token,
  complete: true,
  accepted: [],
  observations: [],
  issues: [],
})
describe('desktop preview session ownership', () => {
  it('retries the native remembered selection when restoring a directory failed', async () => {
    const saved = status()
    const initial = { ...saved, active: null, restore_error: 'workspace-missing' }
    const api = vi.fn(async (command: string) =>
      command === 'workspace_preview_status'
        ? initial
        : command === 'workspace_preview_restore'
          ? saved
          : scan(saved.active!.token),
    )
    const preview = createWorkspacePreview(api as PreviewApi)
    await preview.refresh()
    expect(preview.status.value?.active).toBeNull()
    await preview.retry()
    expect(api).toHaveBeenCalledWith('workspace_preview_restore', { epoch: initial.epoch })
    expect(preview.status.value?.active?.token).toBe(saved.active!.token)
    expect(preview.status.value?.restore_error).toBeNull()
  })
  it('cancelling a picker preserves the visible session without rereading files', async () => {
    const saved = status()
    const api = vi.fn(async (command: string) =>
      command === 'workspace_preview_status'
        ? saved
        : command === 'workspace_preview_scan'
          ? scan(saved.active!.token)
          : null,
    )
    const preview = createWorkspacePreview(api as PreviewApi)
    await preview.refresh()
    const before = preview.scan.value
    await preview.choose('open')
    expect(preview.scan.value).toBe(before)
    expect(api.mock.calls.filter(([cmd]) => cmd === 'workspace_preview_scan')).toHaveLength(1)
  })
  it('a failed switch keeps the current session and surfaces the error', async () => {
    const saved = status()
    const api = vi.fn(async (command: string) => {
      if (command === 'workspace_preview_status') return saved
      if (command === 'workspace_preview_scan') return scan(saved.active!.token)
      throw 'prototype-root-must-be-empty'
    })
    const preview = createWorkspacePreview(api as PreviewApi)
    await preview.refresh()
    const priorScan = preview.scan.value
    await preview.choose('create')
    expect(preview.status.value?.active?.token).toBe(saved.active!.token)
    expect(preview.error.value).toBe('prototype-root-must-be-empty')
    expect(preview.scan.value).toBe(priorScan)
    expect(preview.busy.value).toBe(false)
  })
  it('rejects a scan from another session instead of showing its contents', async () => {
    const saved = status()
    const preview = createWorkspacePreview((async (command: string) =>
      command === 'workspace_preview_status' ? saved : scan(crypto.randomUUID())) as PreviewApi)
    await preview.refresh()
    expect(preview.error.value).toBe('stale-workspace-session')
    expect(preview.scan.value).toBeUndefined()
  })
  it('ignores delayed data after the view is disposed', async () => {
    const saved = status()
    let reply!: (value: unknown) => void
    const preview = createWorkspacePreview((async (command: string) =>
      command === 'workspace_preview_status'
        ? saved
        : new Promise<unknown>((resolve) => {
            reply = resolve
          })) as PreviewApi)
    const loading = preview.refresh()
    await vi.waitFor(() => expect(reply).toBeDefined())
    preview.dispose()
    reply(scan(saved.active!.token))
    await loading
    expect(preview.scan.value).toBeUndefined()
  })
})
