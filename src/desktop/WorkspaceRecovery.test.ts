// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createApp, nextTick } from 'vue'
import WorkspaceRecovery from './WorkspaceRecovery.vue'
import { currentWorkspace, recentWorkspace, workspaceStatus } from './workspaces'
import { createWorkspaceBackups } from './workspace-backups'
import { setLocale } from '../i18n'
import type { BackupEntry, BackupPolicy } from './workspace-backups'

const bridge = vi.hoisted(() => ({
  configuration: vi.fn(),
  list: vi.fn(),
  target: vi.fn(),
  policy: vi.fn(),
  run: vi.fn(),
  inspect: vi.fn(),
  search: vi.fn(),
  restore: vi.fn(),
  maintenance: vi.fn(),
  cancel: vi.fn(),
}))
vi.mock('./workspace-backups', async () => {
  const { shallowRef } = await import('vue')
  return { createWorkspaceBackups: vi.fn(() => bridge), automaticBackupReport: shallowRef() }
})
vi.mock('./workspaces', async () => {
  const { shallowRef } = await import('vue')
  return {
    workspaceStatus: shallowRef(),
    currentWorkspace: vi.fn(),
    recentWorkspace: vi.fn(),
    nativeError: (value: unknown) => new Error(String(value)),
  }
})
vi.mock('./WorkspaceAttachments.vue', () => ({
  default: { template: '<div data-attachment-fixture />' },
}))

const policy: BackupPolicy = {
  enabled: false,
  intervalMinutes: 60,
  hourly: 24,
  daily: 7,
  weekly: 4,
  monthly: 12,
}
const configuration = () => ({ policy: { ...policy }, targets: ['D:/backup'] })
const entry = (): BackupEntry => ({
  key: crypto.randomUUID(),
  summary: {
    id: crypto.randomUUID(),
    sourceWorkspaceId: crypto.randomUUID(),
    archivePath: 'D:/backup/full.repeaty-workspace',
    createdAt: '2026-10-29T08:00:00Z',
    revision: 7,
    fileCount: 20,
    totalBytes: 10240,
    sha256: 'a'.repeat(64),
    manifestSha256: 'b'.repeat(64),
    verified: true,
    counts: { notes: 3, cards: 4, values_store: 2 },
  },
})
let unmount: () => void
beforeEach(() => {
  setLocale('zh-CN')
  workspaceStatus.value = {
    epoch: crypto.randomUUID(),
    active: { id: crypto.randomUUID(), token: crypto.randomUUID(), path: 'D:/fixture' },
    recent: [],
    error: null,
  }
  vi.mocked(currentWorkspace).mockResolvedValue(workspaceStatus.value.active!)
  bridge.configuration.mockResolvedValue(configuration())
  bridge.list.mockResolvedValue({ entries: [], errors: [] })
  bridge.target.mockResolvedValue({ ...configuration(), targets: ['D:/another'] })
  bridge.policy.mockImplementation(async (value: BackupPolicy) => ({
    ...configuration(),
    policy: { ...value },
  }))
  bridge.run.mockResolvedValue([])
  bridge.inspect.mockResolvedValue(entry())
  bridge.search.mockResolvedValue([])
  bridge.cancel.mockResolvedValue(undefined)
  vi.mocked(recentWorkspace).mockResolvedValue(undefined)
})
afterEach(() => {
  unmount?.()
  document.body.innerHTML = ''
  vi.clearAllMocks()
})
function button(text: string, root: ParentNode = document) {
  return [...root.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent?.trim() === text,
  )!
}
async function mount(standalone = false) {
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp(WorkspaceRecovery, { standalone })
  app.mount(host)
  unmount = () => app.unmount()
  await nextTick()
  if (!standalone)
    await vi.waitFor(() => expect(host.querySelector('.recovery-policy')).not.toBeNull())
  return host
}
async function openPreview(host: HTMLElement) {
  button('打开完整备份', host).click()
  await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).not.toBeNull())
  return document.querySelector<HTMLElement>('[role="dialog"]')!
}

it('restores a backup without first opening or creating a learning library', async () => {
  workspaceStatus.value = { ...workspaceStatus.value!, active: null, error: 'workspace-missing' }
  const restoredId = crypto.randomUUID()
  bridge.restore.mockResolvedValue({
    path: 'D:/restore-parent',
    result: { newWorkspaceId: restoredId, restoredPath: 'D:/restore-parent/Recovered' },
  })
  const host = await mount(true)
  expect(createWorkspaceBackups).toHaveBeenCalledWith('')
  expect(currentWorkspace).not.toHaveBeenCalled()
  expect(bridge.configuration).not.toHaveBeenCalled()
  expect(bridge.list).not.toHaveBeenCalled()
  expect(host.querySelector('[data-attachment-fixture]')).toBeNull()
  expect(host.textContent).not.toContain('立即备份')
  expect(host.textContent).not.toContain('数据库检查与空间整理')
  const dialog = await openPreview(host)
  button('恢复为新工作目录', dialog).click()
  await vi.waitFor(() => expect(dialog.textContent).toContain('D:/restore-parent/Recovered'))
  expect(bridge.restore).toHaveBeenCalledWith(expect.any(String), expect.any(String), undefined)
  button('打开恢复的工作目录', dialog).click()
  await vi.waitFor(() =>
    expect(recentWorkspace).toHaveBeenCalledWith('D:/restore-parent/Recovered', restoredId),
  )
})

it('shows an explicit empty search result and cancelled restore never invents success', async () => {
  bridge.restore.mockResolvedValue(null)
  const host = await mount()
  const dialog = await openPreview(host)
  dialog
    .querySelector('form')!
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  await vi.waitFor(() => expect(dialog.textContent).toContain('此备份中没有匹配的内容。'))
  button('恢复为新工作目录', dialog).click()
  await vi.waitFor(() => expect(bridge.restore).toHaveBeenCalledOnce())
  expect(dialog.querySelector('.recovery-result')).toBeNull()
})

it('requires verified preview bytes and restores the selected version key instead of its path', async () => {
  const unverified = entry()
  unverified.summary.verified = false
  unverified.summary.sha256 = ''
  bridge.inspect.mockResolvedValueOnce(unverified)
  const host = await mount()
  button('打开完整备份', host).click()
  await vi.waitFor(() => expect(host.textContent).toContain('备份损坏或校验不一致'))
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  const dialog = await openPreview(host)
  bridge.search.mockResolvedValueOnce([
    {
      store: 'history.notes',
      id: 'note',
      title: 'Archived version',
      excerpt: 'old body',
      path: 'notes/note.md',
      restoreKey: 'snapshot:7:note',
      retired: false,
    },
  ])
  dialog
    .querySelector('form')!
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  await vi.waitFor(() => expect(dialog.textContent).toContain('Archived version'))
  dialog.querySelector<HTMLButtonElement>('[role="checkbox"]')!.click()
  await nextTick()
  bridge.restore.mockResolvedValue(null)
  button('恢复所选文件副本', dialog).click()
  await vi.waitFor(() =>
    expect(bridge.restore).toHaveBeenCalledWith(expect.any(String), expect.any(String), [
      'snapshot:7:note',
    ]),
  )
})

it('preserves unsaved retention settings through refresh and backup until explicitly saved', async () => {
  const host = await mount()
  const input = host.querySelector<HTMLInputElement>('input[type="number"]')!
  input.value = '90'
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
  await nextTick()
  expect(host.textContent).toContain('规则有未保存的更改')
  button('立即备份', host).click()
  await vi.waitFor(() => expect(bridge.configuration).toHaveBeenCalledTimes(2))
  await nextTick()
  expect(input.value).toBe('90')
  expect(bridge.policy).not.toHaveBeenCalled()
  button('保存规则', host).click()
  await vi.waitFor(() =>
    expect(bridge.policy).toHaveBeenCalledWith({ ...policy, intervalMinutes: 90 }),
  )
  await vi.waitFor(() => expect(host.textContent).not.toContain('规则有未保存的更改'))
})

it('ignores a late standalone inspection when session epoch changes', async () => {
  workspaceStatus.value = { ...workspaceStatus.value!, active: null }
  let release!: (value: BackupEntry) => void
  bridge.inspect.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve
      }),
  )
  const host = await mount(true)
  button('打开完整备份', host).click()
  workspaceStatus.value = { ...workspaceStatus.value!, epoch: crypto.randomUUID() }
  release(entry())
  await nextTick()
  await nextTick()
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(button('打开完整备份', host).disabled).toBe(true)
  expect(host.textContent).toContain('stale-workspace-session')
})
