// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createApp, nextTick, shallowRef } from 'vue'
import SyncSettings from './SyncSettings.vue'
import { setLocale } from '../i18n'
import { isPrivateSyncAddress, syncUiKey, type SyncAction, type SyncUiState } from '../sync/ui'

let unmount: (() => void) | undefined
const clipboard = vi.fn(async (_value: string) => {})
beforeEach(() => {
  setLocale('zh-CN')
  vi.clearAllMocks()
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: clipboard },
  })
})
afterEach(() => {
  unmount?.()
  unmount = undefined
  document.body.innerHTML = ''
})

function initial(overrides: Partial<SyncUiState> = {}): SyncUiState {
  return {
    available: true,
    phase: 'idle',
    enabled: true,
    paused: false,
    deviceId: 'device-this',
    groupId: 'group-this',
    address: '192.168.1.8:43127',
    invite: null,
    peers: [{ id: 'device-other', name: 'Study laptop', address: '192.168.1.9:43127' }],
    requests: [],
    pending: 0,
    conflicts: [],
    preview: null,
    message: null,
    error: null,
    blockedReason: null,
    ...overrides,
  }
}
async function mount(
  overrides: Partial<SyncUiState> = {},
  implementation?: (action: SyncAction) => Promise<void>,
) {
  const state = shallowRef(initial(overrides))
  const run = vi.fn(implementation ?? (async (_action: SyncAction) => {}))
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp(SyncSettings)
  app.provide(syncUiKey, { state, run })
  app.mount(host)
  unmount = () => app.unmount()
  await nextTick()
  return { host, state, run }
}
function button(label: string, root: ParentNode = document) {
  const result = [...root.querySelectorAll<HTMLButtonElement>('button')].find(
    (entry) => entry.textContent?.trim() === label,
  )
  expect(result, `Button: ${label}`).toBeDefined()
  return result!
}
async function click(label: string) {
  button(label).click()
  await nextTick()
  await Promise.resolve()
  await nextTick()
}
async function input(element: HTMLInputElement, value: string) {
  element.value = value
  element.dispatchEvent(new Event('input', { bubbles: true }))
  await nextTick()
}

it('only accepts explicit private or loopback address literals', () => {
  for (const address of [
    '10.2.3.4:443',
    '172.16.0.2:65535',
    '192.168.1.8:43127',
    '127.0.0.1:80',
    '[::1]:80',
    '[fd12::1]:80',
  ]) {
    expect(isPrivateSyncAddress(address), address).toBe(true)
  }
  for (const address of [
    '8.8.8.8:80',
    '0.0.0.0:80',
    '192.168.1.8:0',
    '192.168.1.8:65536',
    'localhost:80',
    'https://192.168.1.8',
    '192.168.1.8:80/path',
    '[::]:80',
    '[2001:db8::1]:80',
    '192.168.1.999:80',
    '127.00.0.1:80',
  ]) {
    expect(isPrivateSyncAddress(address), address).toBe(false)
  }
})

it('never starts a network action or exposes an invitation on mount', async () => {
  const secret = 'pairing-invitation-secret'
  const { host, run, state } = await mount({ invite: secret })
  expect(run).not.toHaveBeenCalled()
  expect(clipboard).not.toHaveBeenCalled()
  expect(host.innerHTML).not.toContain(secret)
  await click('添加设备或更改连接')
  await click('显示邀请')
  expect(host.querySelector('textarea')?.value).toBe(secret)
  await click('隐藏邀请')
  expect(host.querySelector('textarea')).toBeNull()
  await click('复制邀请')
  expect(clipboard).toHaveBeenCalledExactlyOnceWith(secret)
  await click('显示邀请')
  state.value = { ...state.value, groupId: 'different-group', invite: 'new-secret' }
  await nextTick()
  expect(host.querySelector('textarea')).toBeNull()
  expect(host.textContent).not.toContain('邀请已复制。')
})

it('keeps setup collapsed for a paired library and opens it for a new group', async () => {
  const { host, state } = await mount({ requests: [{ id: 'request-one', name: 'Desk computer' }] })
  expect(host.querySelector('input')).toBeNull()
  expect(button('添加设备或更改连接').getAttribute('aria-expanded')).toBe('false')
  expect(button('批准加入')).toBeDefined()
  state.value = initial({ groupId: null, enabled: false })
  await nextTick()
  await vi.waitFor(() => expect(host.querySelector('input[type="text"]')).not.toBeNull())
  expect(button('添加设备或更改连接').getAttribute('aria-expanded')).toBe('true')
})

it('rejects a public listener address and preserves input after a failed action', async () => {
  const { host, run } = await mount({}, async () => {
    throw new Error('secret-in-error')
  })
  await click('添加设备或更改连接')
  const address = host.querySelector<HTMLInputElement>('input[type="text"]')!
  await input(address, '8.8.8.8:80')
  await click('设置监听地址')
  expect(run).not.toHaveBeenCalled()
  expect(host.textContent).toContain('请输入私有局域网或回环 IP 地址与端口。')
  await input(address, '10.0.0.7:43127')
  await click('设置监听地址')
  expect(run).toHaveBeenCalledWith({ type: 'listen', address: '10.0.0.7:43127' })
  expect(address.value).toBe('10.0.0.7:43127')
  expect(host.textContent).toContain('同步操作未完成，请重试。')
  expect(host.textContent).not.toContain('secret-in-error')
})

it('blocks applying during study and requires a preview with no unresolved conflict', async () => {
  const { state, run } = await mount({ pending: 2, blockedReason: '请先结束当前复习。' })
  expect(button('确认合入学习库').disabled).toBe(true)
  await click('预览合入')
  expect(run).toHaveBeenLastCalledWith({ type: 'preview' })
  state.value = { ...state.value, preview: { changes: 1, events: 1 } }
  await nextTick()
  expect(button('确认合入学习库').disabled).toBe(true)
  state.value = { ...state.value, blockedReason: null }
  await nextTick()
  await click('确认合入学习库')
  expect(run).toHaveBeenLastCalledWith({ type: 'apply' })
  state.value = {
    ...state.value,
    conflicts: [
      {
        id: 'c1',
        store: 'notes',
        recordId: 'note-one',
        label: 'Visible question',
        fields: ['front'],
        local: 'Local text',
        remote: 'Remote text',
      },
    ],
  }
  await nextTick()
  expect(button('确认合入学习库').disabled).toBe(true)
  expect(document.body.textContent).toContain('Visible question')
  expect(document.body.textContent).toContain('笔记 · 问题')
  expect(document.body.textContent).not.toContain('notes · front')
  await click('查看并处理')
  await vi.waitFor(() => expect(document.body.textContent).toContain('Remote text'))
  await click('使用远端版本')
  expect(run).toHaveBeenLastCalledWith({ type: 'resolve', id: 'c1', choice: 'remote' })
  expect(run.mock.calls.filter(([action]) => action.type === 'apply')).toHaveLength(1)
})

it('requires confirmation before revoking a paired device and dispatches approvals explicitly', async () => {
  const { run } = await mount({ requests: [{ id: 'request-one', name: 'Desk computer' }] })
  await click('批准加入')
  expect(run).toHaveBeenLastCalledWith({ type: 'approve', id: 'request-one' })
  await click('移除设备')
  expect(run.mock.calls.some(([action]) => action.type === 'revoke')).toBe(false)
  await vi.waitFor(() => expect(document.body.textContent).toContain('已下载的内容仍保留'))
  await click('确认移除')
  expect(run).toHaveBeenLastCalledWith({ type: 'revoke', id: 'device-other' })
})

it('summarizes a schedule choice while keeping both review histories and hiding technical details', async () => {
  const { run } = await mount({
    conflicts: [
      {
        id: 'schedule-choice',
        store: 'cards',
        recordId: 'card-one',
        label: 'A question',
        fields: ['schedule'],
        local: { due: '2026-11-01T10:00:00Z', reps: 5, lapses: 1 },
        remote: { due: '2026-11-02T10:00:00Z', reps: 6, lapses: 2 },
      },
    ],
  })
  await click('查看并处理')
  await vi.waitFor(() => expect(document.body.textContent).toContain('两边的评分历史都会保留'))
  expect(document.body.textContent).toContain('下次复习时间')
  expect(document.body.textContent).toContain('复习次数')
  expect(document.body.textContent).toContain('遗忘次数')
  expect(document.body.textContent).not.toContain('"due"')
  await click('使用本机版本')
  expect(run).toHaveBeenLastCalledWith({ type: 'resolve', id: 'schedule-choice', choice: 'local' })
})

it('clears invitation input on a workspace change and ignores late failures', async () => {
  let reject!: (reason: Error) => void
  const { host, state } = await mount(
    {},
    () =>
      new Promise((_resolve, fail) => {
        reject = fail
      }),
  )
  await click('添加设备或更改连接')
  await input(host.querySelector<HTMLInputElement>('input[type="password"]')!, 'private-invite')
  await click('申请加入')
  state.value = initial({ groupId: 'next-group', deviceId: 'next-device' })
  await nextTick()
  reject(new Error('private-invite'))
  await Promise.resolve()
  await nextTick()
  await click('添加设备或更改连接')
  expect(host.querySelector<HTMLInputElement>('input[type="password"]')!.value).toBe('')
  expect(host.textContent).not.toContain('同步操作未完成')
  expect(host.textContent).not.toContain('private-invite')
})

it('requires confirmation to leave while explaining that learning data is kept', async () => {
  const { run } = await mount()
  await click('退出同步组')
  expect(run).not.toHaveBeenCalled()
  await vi.waitFor(() => expect(document.body.textContent).toContain('学习内容和插件数据保留'))
  await click('确认退出同步组')
  expect(run).toHaveBeenLastCalledWith({ type: 'leave' })
})

it('allows cancellation while a command is pending and ignores completion after unmount', async () => {
  let finish!: () => void
  const { run } = await mount({}, async (action) => {
    if (action.type === 'exchange')
      await new Promise<void>((resolve) => {
        finish = resolve
      })
  })
  await click('立即交换更新')
  expect(button('取消当前操作').disabled).toBe(false)
  await click('取消当前操作')
  expect(run).toHaveBeenLastCalledWith({ type: 'cancel' })
  unmount?.()
  unmount = undefined
  finish()
  await Promise.resolve()
  expect(document.body.textContent).toBe('')
})

it('renders a usable unavailable state without an injected desktop service', async () => {
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp(SyncSettings)
  app.mount(host)
  unmount = () => app.unmount()
  await nextTick()
  expect(host.textContent).toContain('请先打开桌面工作目录。')
  expect(button('启动同步').disabled).toBe(true)
})

it('uses the registered English catalog for sync controls and guidance', async () => {
  setLocale('en')
  const { host } = await mount({ requests: [{ id: 'request-one', name: 'Desk computer' }] })
  await click('Add a device or change connection')
  expect(host.textContent).toContain('LAN sync')
  expect(host.textContent).toContain('Exchange updates now')
  expect(host.textContent).not.toMatch(/[\u4e00-\u9fff]/)
})
