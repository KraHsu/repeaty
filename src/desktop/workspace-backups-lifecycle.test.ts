import { afterEach, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import type { useLibrary } from '../composables/useLibrary'
const { current, api } = vi.hoisted(() => ({ current: vi.fn(), api: vi.fn() }))
vi.mock('./workspaces', () => ({
  currentWorkspace: current,
  workspaceApi: api,
  workspaceStatus: { value: undefined },
}))
import { automaticBackupReport, connectAutomaticBackups } from './workspace-backups'
afterEach(() => {
  vi.useRealTimers()
  vi.resetAllMocks()
  automaticBackupReport.value = undefined
})
it('never overlaps automatic backup work and cancels in-flight work when the application unmounts', async () => {
  vi.useFakeTimers()
  current.mockResolvedValue({ token: 'library-token' })
  let finish!: (value: unknown) => void
  api.mockImplementation((command: string) =>
    command === 'workspace_backup_cancel'
      ? Promise.resolve()
      : new Promise((resolve) => {
          finish = resolve
        }),
  )
  const reader = { ready: ref(true), busy: ref(false) } as unknown as ReturnType<typeof useLibrary>
  const stop = await connectAutomaticBackups(reader)
  await vi.advanceTimersByTimeAsync(120_000)
  expect(api).toHaveBeenCalledTimes(1)
  const job = api.mock.calls[0]![1].request.job
  stop()
  expect(api).toHaveBeenLastCalledWith('workspace_backup_cancel', { job })
  finish([])
  await vi.advanceTimersByTimeAsync(120_000)
  expect(api).toHaveBeenCalledTimes(2)
  expect(automaticBackupReport.value).toBeUndefined()
})
it('does not start a timer when no workspace is available', async () => {
  vi.useFakeTimers()
  current.mockRejectedValue(new Error('workspace-not-open'))
  const stop = await connectAutomaticBackups({} as ReturnType<typeof useLibrary>)
  await vi.advanceTimersByTimeAsync(300_000)
  expect(api).not.toHaveBeenCalled()
  expect(vi.getTimerCount()).toBe(0)
  stop()
})
