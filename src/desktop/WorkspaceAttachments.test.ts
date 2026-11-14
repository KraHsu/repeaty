// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { createApp, nextTick } from 'vue'
import WorkspaceAttachments from './WorkspaceAttachments.vue'
import { workspaceStatus } from './workspaces'
import { setLocale } from '../i18n'
import type { AttachmentInventory } from './attachments'

const { load, mutate, cancel } = vi.hoisted(() => ({
  load: vi.fn(),
  mutate: vi.fn(),
  cancel: vi.fn(),
}))
vi.mock('./attachments', async () => ({
  ...(await vi.importActual('./attachments')),
  createAttachmentClient: () => ({ load, mutate, cancel }),
}))
let unmount: () => void
afterEach(() => {
  unmount?.()
  document.body.innerHTML = ''
  vi.clearAllMocks()
})
function view(): AttachmentInventory {
  return {
    revision: 1,
    inventoryToken: 'preview',
    pluginProtection: false,
    totals: {
      physicalBytes: 4096,
      uniqueBytes: 4096,
      duplicateBytes: 0,
      objects: 2,
      workingFiles: 0,
      unused: 1,
      trash: 0,
      external: 0,
    },
    entries: [
      {
        id: 'unused',
        name: 'unused.png',
        path: '.repeaty/media/unused.png',
        mime: 'image/png',
        size: 1024,
        hash: 'a'.repeat(64),
        state: 'unused',
        source: 'managed',
        refs: {},
        trashedAt: null,
        available: true,
      },
      {
        id: 'used',
        name: 'used.png',
        path: '.repeaty/media/used.png',
        mime: 'image/png',
        size: 3072,
        hash: 'b'.repeat(64),
        state: 'referenced',
        source: 'managed',
        refs: { history: 1 },
        trashedAt: null,
        available: true,
      },
    ],
  }
}
function button(text: string, root: ParentNode = document) {
  return [...root.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent?.trim() === text,
  )!
}
async function mount() {
  setLocale('zh-CN')
  workspaceStatus.value = {
    epoch: crypto.randomUUID(),
    active: { id: crypto.randomUUID(), token: crypto.randomUUID(), path: 'D:/fixture' },
    recent: [],
    error: null,
  }
  load.mockResolvedValue(view())
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp(WorkspaceAttachments)
  app.mount(host)
  unmount = () => app.unmount()
  button('检查附件').click()
  await vi.waitFor(() => expect(host.textContent).toContain('unused.png'))
  return host
}
it('requires a concrete preview confirmation and prevents selecting protected attachments', async () => {
  const host = await mount()
  const checks = host.querySelectorAll<HTMLButtonElement>('[role="checkbox"]')
  expect(checks[1]!.disabled).toBe(true)
  checks[0]!.click()
  await nextTick()
  button('移入回收站', host).click()
  await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).not.toBeNull())
  const dialog = document.querySelector('[role="dialog"]')!
  expect(dialog.textContent).toContain('.repeaty/media/unused.png')
  expect(mutate).not.toHaveBeenCalled()
  button('取消', dialog).click()
  await nextTick()
  expect(mutate).not.toHaveBeenCalled()
  button('移入回收站', host).click()
  await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).not.toBeNull())
  const result = view()
  result.entries[0]!.state = 'trash'
  result.totals.trash = 1
  mutate.mockResolvedValue(result)
  button('移入回收站', document.querySelector('[role="dialog"]')!).click()
  await vi.waitFor(() => expect(mutate).toHaveBeenCalledWith(view(), 'trash', ['unused']))
  await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull())
})
it('clears inventory and pending selection when the learning library changes', async () => {
  const host = await mount()
  host.querySelector<HTMLButtonElement>('[role="checkbox"]')!.click()
  await nextTick()
  workspaceStatus.value = {
    ...workspaceStatus.value!,
    active: { ...workspaceStatus.value!.active!, token: crypto.randomUUID() },
  }
  await nextTick()
  expect(host.textContent).not.toContain('unused.png')
  expect(cancel).toHaveBeenCalled()
  expect(button('检查附件')).toBeDefined()
})
