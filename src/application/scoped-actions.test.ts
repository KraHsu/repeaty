import { expect, it, vi } from 'vitest'
import { createScopedActionRunner } from './scoped-actions'
it.each(['switch', 'dispose'] as const)('ignores delayed feedback after %s', async (mode) => {
  let scope = 'first',
    alive = true,
    finish!: () => void
  const success = vi.fn(),
    failure = vi.fn()
  const run = createScopedActionRunner({
    scope: () => scope,
    alive: () => alive,
    start: vi.fn(),
    success,
    failure,
  })
  const pending = run(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve
      }),
    'Saved',
  )
  if (mode === 'switch') scope = 'second'
  else alive = false
  finish()
  expect(await pending).toBe(false)
  expect(success).not.toHaveBeenCalled()
  expect(failure).not.toHaveBeenCalled()
})
it('reports failures for the current view and remains usable on retry', async () => {
  const success = vi.fn(),
    failure = vi.fn(),
    start = vi.fn()
  const run = createScopedActionRunner({
    scope: () => 'current',
    alive: () => true,
    start,
    success,
    failure,
  })
  const error = new Error('Failed write')
  expect(
    await run(async () => {
      throw error
    }),
  ).toBe(false)
  expect(failure).toHaveBeenCalledWith(error)
  expect(await run(async () => {}, 'Saved')).toBe(true)
  expect(success).toHaveBeenCalledWith('Saved')
  expect(start).toHaveBeenCalledTimes(2)
})
