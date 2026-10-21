import 'fake-indexeddb/auto'
import { expect, it, vi } from 'vitest'
import { createRepository, type BackupSummary } from '../core/storage'
import { fixture } from '../core/test-fixtures'
import { useLibrary } from './useLibrary'
const factory = vi.hoisted(() => vi.fn())
vi.mock('@repeaty-platform', () => ({ createWorkspaceRepository: factory }))

it('shows the next card after its durable save without waiting for metadata; an old metadata failure cannot affect a new workspace', async () => {
  const first = createRepository(`study-first-${crypto.randomUUID()}`),
    second = createRepository(`study-second-${crypto.randomUUID()}`)
  try {
    await first.save(fixture(), 0)
    await second.save(fixture({ front: 'Second workspace' }), 0)
    let connectSecond!: (value: typeof second) => void
    const connecting = new Promise<typeof second>((resolve) => {
      connectSecond = resolve
    })
    factory.mockResolvedValueOnce(first).mockReturnValueOnce(connecting)
    const workspace = useLibrary()
    await workspace.init()
    let reject!: (error: Error) => void
    const metadata = new Promise<BackupSummary[]>((_resolve, no) => {
      reject = no
    })
    vi.spyOn(first, 'listBackups').mockReturnValueOnce(metadata)
    await workspace.review(workspace.library.value.cards[0]!.id, 3)
    expect(workspace.busy.value).toBe(false)
    expect((await first.load()).library.reviews).toHaveLength(1)
    const changing = workspace.init()
    reject(new Error('late metadata failure during endpoint switch'))
    await Promise.resolve()
    await Promise.resolve()
    expect(workspace.backupError.value).toBe('')
    connectSecond(second)
    await changing
    expect(workspace.library.value.notes[0]!.front).toBe('Second workspace')
    expect(workspace.backupError.value).toBe('')
    expect(workspace.library.value.reviews).toHaveLength(0)
  } finally {
    await first.close()
    await second.close()
    factory.mockReset()
  }
})
