import { afterEach, expect, it, vi } from 'vitest'
import { readBrowserWorkspace } from './worker-client'
import type { WorkspaceRequest, WorkspaceReply } from './workspace.worker'
import { fixture } from '../core/test-fixtures'

class FakeWorker {
  static latest: FakeWorker
  onmessage: ((event: MessageEvent<WorkspaceReply>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  onmessageerror: (() => void) | null = null
  terminate = vi.fn()
  messages: { id: number; request: WorkspaceRequest }[] = []
  constructor() {
    FakeWorker.latest = this
  }
  postMessage(value: { id: number; request: WorkspaceRequest }) {
    this.messages.push(value)
  }
  reply(value: WorkspaceReply) {
    this.onmessage?.({ data: value } as MessageEvent<WorkspaceReply>)
  }
}
function start() {
  vi.stubGlobal('Worker', FakeWorker)
  const abort = new AbortController(),
    progress = vi.fn()
  const opening = readBrowserWorkspace({ kind: 'files', files: [] }, abort.signal, progress)
  return { abort, progress, opening, worker: FakeWorker.latest }
}
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

it('keeps a worker alive for lazy reads and rejects in-flight reads on close', async () => {
  const { opening, worker, progress } = start()
  worker.reply({ id: 1, type: 'progress', percent: 40 })
  worker.reply({
    id: 1,
    type: 'result',
    value: { id: crypto.randomUUID(), name: '工作目录', revision: 4, library: fixture() },
  })
  const source = await opening
  expect(progress).toHaveBeenCalledWith(40)
  expect(worker.terminate).not.toHaveBeenCalled()
  const reading = source.media('image')
  worker.reply({ id: 2, type: 'result', value: new Blob(['bytes'], { type: 'image/png' }) })
  expect(await (await reading)!.text()).toBe('bytes')
  const retired = source.retiredNotes!(['note'])
  expect(worker.messages.at(-1)?.request).toEqual({ type: 'retired-notes', ids: ['note'] })
  worker.reply({ id: 3, type: 'result', value: [] })
  expect(await retired).toEqual([])
  const pending = source.attempts(['code'])
  source.close()
  await expect(pending).rejects.toMatchObject({ code: 'closed' })
  await expect(source.media('other')).rejects.toMatchObject({ code: 'closed' })
  expect(worker.terminate).toHaveBeenCalledTimes(1)
})
it('terminates on cancellation and ignores stale replies', async () => {
  const { opening, worker, abort, progress } = start()
  const old = worker.onmessage!
  abort.abort()
  await expect(opening).rejects.toMatchObject({ name: 'AbortError' })
  old({ data: { id: 1, type: 'progress', percent: 100 } } as MessageEvent<WorkspaceReply>)
  expect(progress).not.toHaveBeenCalled()
  expect(worker.terminate).toHaveBeenCalledTimes(1)
})
it('disposes failed opens, keeping the error localized', async () => {
  const { opening, worker } = start()
  worker.reply({ id: 1, type: 'error', code: 'incomplete' })
  await expect(opening).rejects.toMatchObject({ code: 'incomplete' })
  expect(worker.terminate).toHaveBeenCalledTimes(1)
})
it('does not hang after a worker failure or timeout', async () => {
  vi.useFakeTimers()
  const first = start()
  first.worker.onerror?.({ preventDefault: vi.fn() } as unknown as ErrorEvent)
  await expect(first.opening).rejects.toMatchObject({ code: 'unavailable' })
  const second = start()
  const rejected = expect(second.opening).rejects.toMatchObject({ code: 'unavailable' })
  await vi.advanceTimersByTimeAsync(120_000)
  await rejected
  expect(second.worker.terminate).toHaveBeenCalledTimes(1)
})
