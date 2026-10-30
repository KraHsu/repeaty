import { describe, expect, it, vi } from 'vitest'
import { resources } from '../test/plugin-api'
import type { MaterialTaskContext } from '@repeaty/plugin-api'
import { readDocument } from './worker'

function context() {
  const controller = new AbortController(),
    cleanup: (() => void)[] = []
  const worker = {
    onmessage: null as ((event: MessageEvent) => void) | null,
    onerror: null,
    postMessage: vi.fn(),
    terminate: vi.fn(),
  }
  let ready!: () => void
  const created = new Promise<void>((resolve) => {
    ready = resolve
  })
  const value: MaterialTaskContext = {
    signal: controller.signal,
    progress: vi.fn(),
    yield: async () => {},
    onCleanup: (dispose) => cleanup.push(dispose),
    createWorker: () => {
      ready()
      return worker as unknown as Worker
    },
  }
  resources.read.mockReturnValue(new Blob(['self.onmessage = () => {}']))
  return { value, controller, cleanup, worker, created }
}
describe('host-owned worker cancellation', () => {
  it('terminates promptly on abort and ignores late messages', async () => {
    const env = context(),
      pending = readDocument(new Blob(['<p>x</p>']), 'html', 'a.html', env.value)
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    await env.created
    const late = env.worker.onmessage
    env.controller.abort()
    await rejected
    late?.({ data: { type: 'done', book: {} } } as MessageEvent)
    env.cleanup.forEach((dispose) => dispose())
    expect(env.worker.terminate).toHaveBeenCalledTimes(1)
    expect(env.worker.onmessage).toBeNull()
  })
  it('cleans up a successful worker exactly once', async () => {
    const env = context(),
      pending = readDocument(new Blob(['<p>x</p>']), 'html', 'a.html', env.value)
    await env.created
    const book = { kind: 'html', chapters: [] }
    env.worker.onmessage!({ data: { type: 'done', book } } as MessageEvent)
    expect(await pending).toEqual(book)
    env.cleanup.forEach((dispose) => dispose())
    env.controller.abort()
    expect(env.worker.terminate).toHaveBeenCalledTimes(1)
  })
})
