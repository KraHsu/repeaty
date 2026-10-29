import 'fake-indexeddb/auto'
import { afterEach, expect, it, vi } from 'vitest'
import { createPinia, disposePinia, type Pinia } from 'pinia'
import { isReactive } from 'vue'
import { useLibrary } from '../composables/useLibrary'
import { useLibraryStore } from './library'
import { useAppNavigation } from '../app/useAppNavigation'
import { useNotifications } from '../notifications'
import { useBrowserWorkspaceStore } from './browser-workspace'
import { createWorkspaceRepository } from '@repeaty-platform'
import { createRepository } from '../core/storage'
import { fixture, input } from '../core/test-fixtures'

vi.mock('@repeaty-platform', () => ({ createWorkspaceRepository: vi.fn() }))
const owners: { pinia: Pinia; workspace: ReturnType<typeof useLibrary> }[] = []
function owner() {
  const pinia = createPinia(),
    workspace = useLibrary(pinia)
  owners.push({ pinia, workspace })
  return { pinia, workspace }
}
afterEach(async () => {
  for (const entry of owners.splice(0)) {
    await entry.workspace.close()
    disposePinia(entry.pinia)
  }
  vi.restoreAllMocks()
})
it('shares one library per Pinia and preserves shallow record identity', async () => {
  const { pinia, workspace } = owner(),
    other = useLibrary(pinia)
  const repo = createRepository('shared-' + crypto.randomUUID())
  await repo.save(fixture(), 0)
  vi.mocked(createWorkspaceRepository).mockResolvedValue(repo)
  await Promise.all([workspace.init(), other.init()])
  expect(createWorkspaceRepository).toHaveBeenCalledTimes(1)
  expect(workspace.library.value).toBe(other.library.value)
  expect(isReactive(workspace.library.value)).toBe(false)
  const note = workspace.library.value.notes[0]!
  await other.saveNote({ ...input, front: 'Shared edit' })
  expect(workspace.library.value.notes).toHaveLength(2)
  expect(workspace.library.value.notes[0]).toBe(note)
  for (const key of ['repository', 'worker', 'activeReview'])
    expect(Object.keys(useLibraryStore(pinia).$state)).not.toContain(key)
})
it('isolates navigation, notifications and trial state across applications', () => {
  const first = owner(),
    second = owner()
  useAppNavigation(first.pinia).navigate('cards')
  expect(useAppNavigation(second.pinia).tab.value).toBe('overview')
  const a = useNotifications(first.pinia),
    b = useNotifications(second.pinia)
  a.notify('First app', 'warning')
  expect(a.notifications.value).toHaveLength(1)
  expect(b.notifications.value).toHaveLength(0)
  useBrowserWorkspaceStore(first.pinia).open({
    scope: 'one',
    id: crypto.randomUUID(),
    name: 'Trial',
    revision: 1,
    changed: false,
  })
  expect(useBrowserWorkspaceStore(second.pinia).active).toBeNull()
})
it('closes a repository that arrives after its Pinia was disposed', async () => {
  const { pinia, workspace } = owner()
  const repo = createRepository('late-init-' + crypto.randomUUID())
  await repo.save(fixture(), 0)
  const close = vi.spyOn(repo, 'close')
  let release!: (value: typeof repo) => void
  vi.mocked(createWorkspaceRepository).mockImplementation(
    () =>
      new Promise((resolve) => {
        release = resolve
      }),
  )
  const opening = workspace.init()
  await vi.waitFor(() => expect(release).toBeTypeOf('function'))
  disposePinia(pinia)
  release(repo)
  await opening
  expect(workspace.ready.value).toBe(false)
  expect(workspace.scope.value).toBe('')
  expect(close).toHaveBeenCalledTimes(1)
})
it('drains a closing save without letting its response overwrite a reopened library', async () => {
  const { workspace } = owner()
  const first = createRepository('closing-save-' + crypto.randomUUID()),
    second = createRepository('reopen-' + crypto.randomUUID())
  await first.save(fixture(), 0)
  await second.save(fixture({ front: 'Reopened library' }), 0)
  vi.mocked(createWorkspaceRepository).mockResolvedValueOnce(first).mockResolvedValueOnce(second)
  await workspace.init()
  const save = first.save.bind(first),
    close = vi.spyOn(first, 'close')
  let release!: () => void
  vi.spyOn(first, 'save').mockImplementation(async (...args) => {
    const saved = await save(...args)
    return new Promise((resolve) => {
      release = () => resolve(saved)
    })
  })
  const pending = workspace.saveNote({ ...input, front: 'Old save' })
  await vi.waitFor(() => expect(release).toBeTypeOf('function'))
  const closed = workspace.close(),
    reopened = workspace.init()
  release()
  await Promise.all([pending, closed, reopened])
  expect(workspace.ready.value).toBe(true)
  expect(workspace.library.value.notes.map((note) => note.front)).toEqual(['Reopened library'])
  expect(workspace.scope.value).toBe(second.scope())
  expect(workspace.lastOperation.value).toBeUndefined()
  expect(close).toHaveBeenCalledTimes(1)
})
