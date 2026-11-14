import { expect, it, vi } from 'vitest'
import { createWorkspaceBackups } from './workspace-backups'
import type { NativeApi } from './workspaces'

it('uses opaque preview keys and the captured workspace token for search and restore', async () => {
  const invoke = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce(null)
  const client = createWorkspaceBackups('original-token', invoke as NativeApi)
  await client.search('verified-preview', '短语', 'search-job')
  await client.restore('verified-preview', 'job-id', ['notes/chapter.md'])
  expect(invoke.mock.calls).toEqual([
    [
      'workspace_backups',
      {
        token: 'original-token',
        request: { type: 'search', key: 'verified-preview', query: '短语', job: 'search-job' },
      },
    ],
    [
      'workspace_backups',
      {
        token: 'original-token',
        request: {
          type: 'restore',
          key: 'verified-preview',
          job: 'job-id',
          paths: ['notes/chapter.md'],
        },
      },
    ],
  ])
})
it('validates policy before invoking native code and preserves cancelled native dialogs', async () => {
  const invoke = vi.fn().mockResolvedValue(null)
  const client = createWorkspaceBackups('scope', invoke as NativeApi)
  await expect(
    client.policy({
      enabled: true,
      intervalMinutes: 0,
      hourly: 24,
      daily: 7,
      weekly: 4,
      monthly: 12,
    }),
  ).rejects.toThrow()
  expect(invoke).not.toHaveBeenCalled()
  expect(await client.target(0)).toBeNull()
  expect(await client.inspect()).toBeNull()
})
it('cancel does not enqueue behind a running workspace backup request', async () => {
  const invoke = vi
    .fn()
    .mockImplementation((name) =>
      name === 'workspace_backups' ? new Promise(() => {}) : Promise.resolve(),
    )
  const client = createWorkspaceBackups('scope', invoke as NativeApi)
  void client.run('job-id')
  await client.cancel('job-id')
  expect(invoke).toHaveBeenLastCalledWith('workspace_backup_cancel', { job: 'job-id' })
})
