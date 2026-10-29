import { afterEach, expect, it, vi } from 'vitest'
import { PluginTaskScheduler, supportsPluginWorkers } from './tasks'
import type { MaterialTaskContext } from '@repeaty/plugin-api'
import { readFileSync } from 'node:fs'

function deferred<T = void>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function workers() {
  const instances: {
    url: string
    options?: WorkerOptions
    terminate: ReturnType<typeof vi.fn>
  }[] = []
  vi.stubGlobal(
    'Worker',
    class {
      terminate = vi.fn()
      constructor(
        public url: string,
        public options?: WorkerOptions,
      ) {
        instances.push(this)
      }
    },
  )
  const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:owned-worker')
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  return { instances, create, revoke }
}

it('allows owned Blob Workers in desktop CSP without widening script or network execution', () => {
  const config = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8'))
  const directives = new Map<string, string[]>(
    config.app.security.csp.split(';').map((part: string) => {
      const [name, ...values] = part.trim().split(/\s+/)
      return [name, values]
    }),
  )
  expect(directives.get('worker-src')).toEqual(["'self'", 'blob:'])
  expect(directives.get('script-src')).toEqual(["'self'", 'blob:', "'wasm-unsafe-eval'"])
  expect(directives.get('connect-src')).toEqual(["'self'", 'ipc:', 'http://ipc.localhost'])
})

it.each(['success', 'failure', 'caller-cancel', 'unload'] as const)(
  'releases host worker and URL exactly once after %s',
  async (ending) => {
    const { instances, create, revoke } = workers()
    const scheduler = new PluginTaskScheduler(1)
    const lifetime = new AbortController(),
      caller = new AbortController(),
      gate = deferred()
    let context!: MaterialTaskContext
    const run = scheduler.run(
      Symbol(),
      { id: 'worker', title: 'Worker', signal: caller.signal },
      async (ctx) => {
        context = ctx
        ctx.createWorker!('self.onmessage = () => postMessage(1)', {
          type: 'module',
          name: 'parser',
        })
        await gate.promise
        if (ending === 'failure') throw Error('parse-failed')
        return 1
      },
      lifetime.signal,
    )
    await tick()
    expect(supportsPluginWorkers()).toBe(true)
    expect(instances).toHaveLength(1)
    expect(instances[0]!.options).toEqual({ type: 'module', name: 'parser' })
    expect(create).toHaveBeenCalledTimes(1)
    if (ending === 'caller-cancel' || ending === 'unload') {
      const rejected = expect(run).rejects.toMatchObject({ name: 'AbortError' })
      ;(ending === 'unload' ? lifetime : caller).abort()
      await rejected
    } else {
      const result =
        ending === 'failure'
          ? expect(run).rejects.toThrow('parse-failed')
          : expect(run).resolves.toBe(1)
      gate.resolve()
      await result
    }
    expect(instances[0]!.terminate).toHaveBeenCalledTimes(1)
    expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:owned-worker')
    expect(() => context.createWorker!('late')).toThrow()
    gate.resolve()
    lifetime.abort()
    await tick()
    expect(revoke).toHaveBeenCalledTimes(1)
  },
)

it('reclaims constructor failures and refuses unsupported, oversized or invalid worker code before allocating URLs', async () => {
  const { create, revoke } = workers()
  const scheduler = new PluginTaskScheduler()
  const lifetime = new AbortController()
  await scheduler.run(
    Symbol(),
    { id: 'limits', title: 'Limits' },
    async (ctx) => {
      for (const source of ['', ' '.repeat(3), '中'.repeat(400_000)]) {
        expect(() => ctx.createWorker!(source)).toThrow('定义无效')
      }
      expect(() => ctx.createWorker!('code', { type: 'invalid' as 'classic' })).toThrow('定义无效')
      expect(() => ctx.createWorker!('code', { name: 'x'.repeat(101) })).toThrow('定义无效')
      expect(create).not.toHaveBeenCalled()
      vi.stubGlobal(
        'Worker',
        class {
          constructor() {
            throw Error('CSP blocked')
          }
        },
      )
      expect(() => ctx.createWorker!('code')).toThrow('CSP blocked')
      expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:owned-worker')
      vi.stubGlobal('Worker', undefined)
      expect(supportsPluginWorkers()).toBe(false)
      expect(() => ctx.createWorker!('code')).toThrow('不支持')
    },
    lifetime.signal,
  )
  expect(create).toHaveBeenCalledTimes(1)
  expect(revoke).toHaveBeenCalledTimes(1)
})

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
