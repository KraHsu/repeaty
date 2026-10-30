import { describe, expect, it, vi } from 'vitest'
import { fixture } from '../core/test-fixtures'
import { createTransfersCommands } from './library-transfers'
import type { LibraryContext } from './library-context'

function context() {
  const target = { retiredNotes: async () => [] },
    commit = vi.fn(async () => {})
  const value = {
    repository: target,
    scope: { value: 'first-library' },
    revision: 7,
    commit,
    readingUndo: { value: {} },
  }
  return { value, commit, commands: createTransfersCommands(value as unknown as LibraryContext) }
}
describe('asynchronous portable restore preflight', () => {
  it('does not clear the new library reading undo when an earlier restore finishes late', async () => {
    for (const mode of ['portable', 'checkpoint']) {
      const env = context(),
        marker = { retained: true }
      env.commit.mockImplementationOnce(async () => {
        env.value.repository = { retiredNotes: async () => [] }
        env.value.scope.value = 'second-library'
        env.value.readingUndo.value = marker
      })
      if (mode === 'portable') await env.commands.restore({ library: fixture(), assets: [] })
      else await env.commands.restoreSnapshot(fixture())
      expect(env.value.readingUndo.value).toBe(marker)
    }
  })
  it('does not restore into a library switched while identities and documents are being prepared', async () => {
    const env = context(),
      pending = env.commands.restore({ library: fixture(), assets: [] })
    env.value.repository = { retiredNotes: async () => [] }
    env.value.scope.value = 'second-library'
    await expect(pending).rejects.toThrow('学习库已变化')
    expect(env.commit).not.toHaveBeenCalled()
  })
  it('requires the same revision after preflight and clears retired records on an explicit fresh restore', async () => {
    const changed = context(),
      pending = changed.commands.restore({ library: fixture(), assets: [] })
    changed.value.revision++
    await expect(pending).rejects.toThrow('学习库已变化')
    expect(changed.commit).not.toHaveBeenCalled()
    const env = context()
    await env.commands.restore({ library: fixture(), assets: [] })
    expect(env.commit).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ retired: [], undoBarrier: true }),
    )
    expect(env.value.readingUndo.value).toBeUndefined()
  })
})
