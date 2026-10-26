// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { createApp, nextTick } from 'vue'
import WorkspacePreview from './WorkspacePreview.vue'
import { createWorkspaceMarkdown } from '../workspace/markdown'
import { inspectPreview } from '../workspace/preview'
vi.mock('./workspace-inspector', () => ({
  createInspector: () => ({
    inspect: async (scan: import('../workspace/preview').PreviewScan) => inspectPreview(scan),
    dispose() {},
  }),
}))
import { setLocale } from '../i18n'
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke }))
let dispose: (() => void) | undefined
afterEach(() => {
  dispose?.()
  document.body.innerHTML = ''
  vi.clearAllMocks()
  setLocale('zh-CN')
})
async function mount() {
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp(WorkspacePreview)
  app.mount(host)
  dispose = () => app.unmount()
  await vi.waitFor(() => expect(host.querySelector('.workspace-raw')).not.toBeNull())
  return host
}
function responses() {
  const token = crypto.randomUUID()
  const raw = createWorkspaceMarkdown(
    {
      repeaty: {
        version: 1,
        kind: 'note',
        id: 'old',
        deckId: 'deck',
        type: 'basic',
        format: 'markdown',
      },
    },
    { kind: 'note', front: '已接受的正文🙂', back: '答案' },
  )
  invoke.mockImplementation(async (command: string) =>
    command === 'workspace_preview_status'
      ? {
          epoch: crypto.randomUUID(),
          active: { token, id: crypto.randomUUID(), path: '/my/工作目录' },
          recent: [],
          restore_error: null,
        }
      : {
          token,
          complete: true,
          accepted: [{ id: 'old', path: 'notes/note.md', raw, cards: [] }],
          observations: [
            { path: 'notes/note.md', raw: '<script>window.previewExecuted=true</script>' },
          ],
          issues: [],
        },
  )
}
it('shows escaped working text and retains access to the accepted version after identity removal', async () => {
  responses()
  const host = await mount()
  expect(host.querySelector('.workspace-document script')).toBeNull()
  expect(host.querySelector('.workspace-raw')?.textContent).toContain('<script>')
  const button = [...host.querySelectorAll('button')].find(
    (button) => button.textContent === '已接受版本',
  )!
  button.click()
  await nextTick()
  expect(host.querySelector('.workspace-raw')?.textContent).toContain('已接受的正文🙂')
  expect(host.textContent).toContain('预览目录独立于当前学习库')
})
it('translates the full directory entry and errors into English', async () => {
  responses()
  setLocale('en')
  const host = await mount()
  expect(host.textContent).toContain('Open folder')
  expect(host.textContent).toContain('Create preview folder')
  expect(host.textContent).toContain('Accepted version')
  expect(host.textContent).toContain('Browse Markdown files')
  expect(host.textContent).not.toContain('已接受版本')
})

it('renders one page of a large file list and searches files outside that page', async () => {
  const token = crypto.randomUUID()
  invoke.mockImplementation(async (command: string) =>
    command === 'workspace_preview_status'
      ? {
          epoch: crypto.randomUUID(),
          active: { token, id: crypto.randomUUID(), path: '/chosen' },
          recent: [],
          restore_error: null,
        }
      : {
          token,
          complete: true,
          accepted: [],
          observations: Array.from({ length: 101 }, (_, index) => ({
            path: `notes/${String(index).padStart(3, '0')}.md`,
            raw: `file ${index}`,
          })),
          issues: [],
        },
  )
  const host = await mount()
  expect(host.querySelectorAll('.workspace-file')).toHaveLength(50)
  const next = [...host.querySelectorAll('button')].find(
    (button) => button.textContent === '下一页',
  )!
  next.click()
  await nextTick()
  expect(host.querySelectorAll('.workspace-file')).toHaveLength(50)
  const search = host.querySelector<HTMLInputElement>('input[type="search"]')!
  search.value = '100.md'
  search.dispatchEvent(new Event('input', { bubbles: true }))
  await nextTick()
  expect(host.querySelectorAll('.workspace-file')).toHaveLength(1)
  host.querySelector<HTMLButtonElement>('.workspace-file')!.click()
  await nextTick()
  expect(host.querySelector('.workspace-raw')?.textContent).toBe('file 100')
})
