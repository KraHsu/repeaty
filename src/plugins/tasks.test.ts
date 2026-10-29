import { expect, it, vi } from 'vitest'
import { PluginTaskScheduler } from './tasks'
import type { MaterialTaskContext } from '@repeaty/plugin-api'

function deferred<T = void>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

it('bounds active work, preserves FIFO, rejects overflow and cancellation never starts queued parsers', async () => {
  const scheduler = new PluginTaskScheduler(1, 1)
  const owner = Symbol('parser')
  const lifetime = new AbortController()
  const gate = deferred()
  const started: string[] = []
  const first = scheduler.run(
    owner,
    { id: 'first', title: 'First' },
    async () => {
      started.push('first')
      await gate.promise
    },
    lifetime.signal,
  )
  const queuedLifetime = new AbortController()
  const queued = scheduler.run(
    owner,
    { id: 'next', title: 'Next', signal: queuedLifetime.signal },
    async () => {
      started.push('next')
    },
    lifetime.signal,
  )
  await expect(
    scheduler.run(owner, { id: 'overflow', title: 'Overflow' }, async () => {}, lifetime.signal),
  ).rejects.toThrow('队列已满')
  const rejected = expect(queued).rejects.toMatchObject({ name: 'AbortError' })
  queuedLifetime.abort()
  await rejected
  const last = scheduler.run(
    owner,
    { id: 'last', title: 'Last' },
    async () => {
      started.push('last')
    },
    lifetime.signal,
  )
  await tick()
  expect(started).toEqual(['first'])
  gate.resolve()
  await first
  await last
  expect(started).toEqual(['first', 'last'])
})

it('aborts active resources exactly once and never exposes late results or progress', async () => {
  const scheduler = new PluginTaskScheduler(1)
  const owner = Symbol('parser')
  const lifetime = new AbortController()
  const gate = deferred<string>()
  let context!: MaterialTaskContext
  const cleanup = vi.fn(),
    progress = vi.fn()
  const pending = scheduler.run(
    owner,
    { id: 'parse', title: 'Parse', onProgress: progress },
    async (value) => {
      context = value
      value.onCleanup(cleanup)
      value.progress({ completed: 1, total: 2 })
      return gate.promise
    },
    lifetime.signal,
  )
  await tick()
  const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  lifetime.abort()
  await rejected
  expect(cleanup).toHaveBeenCalledTimes(1)
  expect(context.signal.aborted).toBe(true)
  expect(() => context.progress({ completed: 2, total: 2 })).toThrow()
  const lateCleanup = vi.fn()
  context.onCleanup(lateCleanup)
  expect(lateCleanup).toHaveBeenCalledTimes(1)
  gate.resolve('stale')
  await tick()
  expect(progress).toHaveBeenCalledTimes(1)
  expect(cleanup).toHaveBeenCalledTimes(1)
})

it('keeps identically named tasks isolated by activation and cleans errors and invalid progress', async () => {
  const scheduler = new PluginTaskScheduler()
  const owner = Symbol('same'),
    other = Symbol('same')
  const lifetime = new AbortController()
  const gate = deferred()
  const first = scheduler.run(
    owner,
    { id: 'parse', title: 'Parse' },
    async () => gate.promise,
    lifetime.signal,
  )
  const second = scheduler.run(
    other,
    { id: 'parse', title: 'Parse' },
    async () => 2,
    lifetime.signal,
  )
  await expect(
    scheduler.run(owner, { id: 'parse', title: 'Duplicate' }, async () => 3, lifetime.signal),
  ).rejects.toThrow('标识正在使用')
  expect(await second).toBe(2)
  gate.resolve()
  await first
  const cleanup = vi.fn()
  await expect(
    scheduler.run(
      owner,
      { id: 'parse', title: 'Parse' },
      async (ctx) => {
        ctx.onCleanup(cleanup)
        ctx.progress({ completed: 2, total: 1 })
      },
      lifetime.signal,
    ),
  ).rejects.toThrow('进度无效')
  expect(cleanup).toHaveBeenCalledTimes(1)
  expect(
    await scheduler.run(
      owner,
      { id: 'parse', title: 'Parse' },
      async () => 'reusable',
      lifetime.signal,
    ),
  ).toBe('reusable')
})
