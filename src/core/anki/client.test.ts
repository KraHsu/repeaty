import { afterEach, expect, it, vi } from 'vitest'
import { readAnkiFile } from './client'

class ImportWorker {
  static current: ImportWorker
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  onmessageerror: (() => void) | null = null
  terminate = vi.fn()
  postMessage = vi.fn()
  constructor() {
    ImportWorker.current = this
  }
}
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})
it('cancels a worker and removes handlers so late results cannot change the preview', async () => {
  vi.stubGlobal('Worker', ImportWorker)
  const controller = new AbortController(),
    progress = vi.fn()
  const pending = readAnkiFile(new File(['data'], 'test.apkg'), controller.signal, progress)
  const worker = ImportWorker.current
  worker.onmessage!({ data: { type: 'progress', percent: 25 } } as MessageEvent)
  expect(progress).toHaveBeenCalledWith(25)
  controller.abort()
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  expect(worker.terminate).toHaveBeenCalledOnce()
  expect(worker.onmessage).toBeNull()
})
it('terminates a stalled parser at its deadline', async () => {
  vi.useFakeTimers()
  vi.stubGlobal('Worker', ImportWorker)
  const pending = readAnkiFile(
    new File(['data'], 'test.apkg'),
    new AbortController().signal,
    vi.fn(),
  )
  const assertion = expect(pending).rejects.toThrow('处理超时')
  await vi.advanceTimersByTimeAsync(60_000)
  await assertion
  expect(ImportWorker.current.terminate).toHaveBeenCalledOnce()
})
