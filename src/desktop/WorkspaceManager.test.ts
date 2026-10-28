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
async function mount(changed: string, withArchive = false) {
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
  const archivedNote = {
    ...note,
    id: 'archived-note',
    type: 'cloze' as const,
    front: '{{c1::Archived answer}}',
  }
  const archivedRaw = createWorkspaceMarkdown(
    {
      repeaty: {
        version: 1,
        kind: 'note',
        id: archivedNote.id,
        type: archivedNote.type,
        format: 'markdown',
        deckId: 'deck',
      },
    },
    { kind: 'note', front: archivedNote.front, back: archivedNote.back },
  )
  invoke.mockImplementation(async (command, args) =>
    command === 'workspace_status'
      ? { epoch: crypto.randomUUID(), active, recent: [], error: null }
      : args.request.type === 'check-media'
        ? { changed: [] }
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
              scanHash: 'c'.repeat(64),
              retired: withArchive
                ? [
                    {
                      id: archivedNote.id,
                      title: archivedNote.front,
                      path: 'notes/archived.md',
                      retiredAt: note.createdAt,
                      cards: 1,
                    },
                  ]
                : [],
              retiredCount: withArchive ? 1 : 0,
            },
  )
  const accepted = vi.fn().mockResolvedValue(undefined)
  const workspace = {
    busy: ref(false),
    library: shallowRef(library),
    acceptExternalNote: accepted,
    readRetiredNote: vi.fn(async (id: string) => ({
      revision: 0,
      note: withArchive && id === archivedNote.id ? archivedNote : null,
      document:
        withArchive && id === archivedNote.id
          ? { kind: 'note', id, path: 'notes/archived.md', hash: 'd'.repeat(64), raw: archivedRaw }
          : null,
      cards:
        withArchive && id === archivedNote.id
          ? [{ ...library.cards[0]!, id: 'archived-card', noteId: id, variant: 'cloze:1' }]
          : [],
      reviews: [],
      practices: [],
      attempts: [],
      media: [],
    })),
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
  await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).not.toBeNull())
  expect(accepted).not.toHaveBeenCalled()
  await vi.waitFor(() =>
    expect(
      [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(
        (button) => button.textContent?.trim() === '确认接受',
      )?.disabled,
    ).toBe(false),
  )
  ;[...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')]
    .find((button) => button.textContent?.trim() === '确认接受')!
    .click()
  await vi.waitFor(() => expect(accepted).toHaveBeenCalledOnce())
  expect(accepted.mock.calls[0]).toMatchObject([
    note.id,
    { front: '外部编辑' },
    { expectedHash: 'a'.repeat(64), workingHash: 'b'.repeat(64), path: 'notes/card.md' },
    'c'.repeat(64),
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

it('restores the archived type while a different note is selected in the inspector', async () => {
  const { host } = await mount('managed', true)
  const restore = [...host.querySelectorAll('button')].find(
    (button) => button.textContent?.trim() === '恢复笔记',
  )!
  expect(restore).toBeDefined()
  restore.click()
  await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).not.toBeNull())
  const type = document.querySelectorAll<HTMLElement>('[role="dialog"] [role="combobox"]')[1]!
  expect(type.textContent).toContain('挖空卡')
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('恢复 1 张')
  expect(
    [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(
      (button) => button.textContent?.trim() === '确认恢复',
    )?.disabled,
  ).toBe(false)
})
