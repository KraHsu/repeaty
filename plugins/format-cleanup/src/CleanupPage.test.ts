// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { createApp, nextTick } from 'vue'
import { materials } from '../test/plugin-api'
import CleanupPage from './CleanupPage.vue'
import { createCleanupSettings } from './settings'
import { runCleanup } from './run-cleanup'
vi.mock('./run-cleanup', () => ({ runCleanup: vi.fn() }))
const disposers: (() => void)[] = []
afterEach(() => {
  disposers.splice(0).forEach((stop) => stop())
  vi.clearAllMocks()
})
async function settle() {
  for (let i = 0; i < 8; i++) await nextTick()
}
async function mount() {
  const source = {
    id: 'source',
    versionId: 'original',
    title: '测试材料',
    format: 'markdown' as const,
  }
  materials.snapshot.mockReturnValue({
    workspaceScope: 'library',
    revision: 4,
    sources: [source],
    decks: [],
  })
  materials.get.mockResolvedValue({ material: source, text: '原文 ' })
  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp(CleanupPage, {
    workspaceScope: 'library',
    settings: createCleanupSettings(),
  })
  app.mount(root)
  disposers.push(() => {
    app.unmount()
    root.remove()
  })
  await settle()
  const click = (label: string) => {
    const button = [...root.querySelectorAll('button')].find((item) =>
      item.textContent?.includes(label),
    )!
    button.click()
  }
  return { root, click, app }
}
it('requires a preview and explicit confirmation and carries captured immutable identity', async () => {
  vi.mocked(runCleanup).mockResolvedValue('原文')
  materials.editContent.mockResolvedValue({ sourceId: 'source', versionId: 'next', revision: 5 })
  const { root, click } = await mount()
  expect(root.textContent).not.toContain('应用清理')
  click('预览清理')
  await settle()
  expect(materials.editContent).not.toHaveBeenCalled()
  expect([...root.querySelectorAll('textarea')].map((item) => item.value)).toEqual([
    '原文 ',
    '原文',
  ])
  click('应用清理')
  await settle()
  expect(materials.editContent).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      sourceId: 'source',
      versionId: 'original',
      content: '原文',
      expectedRevision: 4,
    }),
  )
  expect(root.textContent).toContain('可使用应用的撤销')
})
it('shows stale-preview failures without retrying edits or discarding the preview', async () => {
  vi.mocked(runCleanup).mockResolvedValue('原文')
  materials.editContent.mockRejectedValue(new Error('学习库内容已变化，请重新预览。'))
  const { root, click } = await mount()
  click('预览清理')
  await settle()
  click('应用清理')
  await settle()
  expect(root.textContent).toContain('已变化，请重新预览')
  expect(root.querySelectorAll('textarea')).toHaveLength(2)
  expect(materials.editContent).toHaveBeenCalledTimes(1)
})
it('ignores cancelled preview responses and never applies after page unmount', async () => {
  let finish!: (text: string) => void
  vi.mocked(runCleanup).mockImplementation(
    () =>
      new Promise((done) => {
        finish = done
      }),
  )
  const { root, click } = await mount()
  click('预览清理')
  await settle()
  click('取消预览')
  finish('late')
  await settle()
  expect(root.querySelectorAll('textarea')).toHaveLength(0)
  expect(materials.editContent).not.toHaveBeenCalled()
})
