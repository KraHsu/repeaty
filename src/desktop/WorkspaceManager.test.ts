// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { createApp, shallowRef, ref } from 'vue'
import Manager from './WorkspaceManager.vue'
import { fixture } from '../core/test-fixtures'
import { createWorkspaceMarkdown } from '../workspace/markdown'
import { inspectPreview } from '../workspace/preview'
import { setLocale } from '../i18n'
import type { useLibrary } from '../composables/useLibrary'
vi.mock('./workspace-inspector', () => ({
  createInspector: () => ({ inspect: inspectPreview, dispose() {} }),
}))
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke }))
let dispose: () => void
const active = { id: crypto.randomUUID(), token: crypto.randomUUID(), path: '/my/学习库' }
afterEach(() => {
  dispose?.()
  document.body.innerHTML = ''
  vi.clearAllMocks()
})
async function mount(changed: string) {
  setLocale('zh-CN')
  const library = fixture({ format: 'markdown' }),
    note = library.notes[0]!
  const raw = createWorkspaceMarkdown(
    {
      repeaty: {
        version: 1,
        kind: 'note',
        id: note.id,
        type: 'basic',
        deckId: 'deck',
        format: 'markdown',
      },
    },
    { kind: 'note', front: note.front, back: note.back },
  )
  invoke.mockImplementation(async (command, args) =>
    command === 'workspace_status'
      ? { epoch: crypto.randomUUID(), active, recent: [], error: null }
      : args.request.type === 'settings'
        ? {}
        : {
            accepted: [
              { kind: 'note', id: note.id, path: 'notes/card.md', hash: 'a'.repeat(64), raw },
            ],
            working: [
              {
                path: 'notes/card.md',
                hash: 'b'.repeat(64),
                raw: changed === 'managed' ? raw.replace('Question', '外部编辑') : changed,
              },
            ],
            attention: [],
          },
  )
  const accepted = vi.fn().mockResolvedValue(undefined)
  const workspace = {
    busy: ref(false),
    library: shallowRef(library),
    acceptExternalNote: accepted,
  } as unknown as ReturnType<typeof useLibrary>
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp(Manager, { workspace })
  app.mount(host)
  dispose = () => app.unmount()
  await vi.waitFor(() => expect(host.querySelector('.workspace-raw')).not.toBeNull())
  return { host, accepted, note }
}
it('shows external bytes safely and keeps the accepted version available after identity removal', async () => {
  const { host } = await mount('<script>window.executed=true</script>')
  expect(host.querySelector('.workspace-raw')?.textContent).toContain('<script>')
  expect(host.querySelector('.workspace-raw script')).toBeNull()
  const accepted = [...host.querySelectorAll('button')].find((button) =>
    button.textContent?.includes('已接受版本'),
  )!
  accepted.click()
  await vi.waitFor(() =>
    expect(host.querySelector('.workspace-raw')?.textContent).toContain('Question'),
  )
  expect(host.textContent).toContain('存在冲突')
})
it('accepts a valid external edit against both the accepted and observed bytes', async () => {
  const { host, accepted, note } = await mount('managed')
  const button = [...host.querySelectorAll('button')].find((button) =>
    button.textContent?.includes('接受修改'),
  )!
  expect(button).toBeDefined()
  button.click()
  await vi.waitFor(() => expect(accepted).toHaveBeenCalledOnce())
  expect(accepted.mock.calls[0]).toMatchObject([
    note.id,
    { front: '外部编辑' },
    { expectedHash: 'a'.repeat(64), workingHash: 'b'.repeat(64), path: 'notes/card.md' },
  ])
})

it('disposes startup before a late status response can launch a scan', async () => {
  const read = vi.fn()
  let release!: (value: unknown) => void
  invoke.mockImplementation((command) => {
    if (command === 'workspace_status')
      return new Promise((resolve) => {
        release = resolve
      })
    read(command)
    return {}
  })
  const workspace = {
    busy: ref(false),
    library: shallowRef(fixture()),
    acceptExternalNote: vi.fn(),
  } as unknown as ReturnType<typeof useLibrary>
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp(Manager, { workspace })
  app.mount(host)
  expect(host.querySelector('.workspace-manager')?.getAttribute('aria-busy')).toBe('true')
  await vi.waitFor(() => expect(release).toBeTypeOf('function'))
  app.unmount()
  release({ epoch: crypto.randomUUID(), active, recent: [], error: null })
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(read).not.toHaveBeenCalled()
})
