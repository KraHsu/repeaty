import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resources } from '../test/plugin-api'
import { snapshot } from '../test/fixture'
import { runTraining } from './runner'
import { TRAINING_ENGINE } from './training'

function setup() {
  const controller = new AbortController(),
    cleanups: (() => void)[] = []
  const worker = {
    onmessage: undefined as ((event: { data: unknown }) => void) | undefined,
    postMessage: vi.fn(),
    terminate: vi.fn(),
  }
  const scope = {
    signal: controller.signal,
    onCleanup: (fn: () => void) => cleanups.push(fn),
    createWorker: vi.fn(() => worker),
    dispose: vi.fn(() => {
      if (controller.signal.aborted) return
      controller.abort()
      worker.terminate()
      cleanups.forEach((fn) => fn())
    }),
  }
  resources.createScope.mockReturnValue(scope)
  resources.read.mockImplementation(
    (path: string) =>
      new Blob([path.includes('wasm') ? new Uint8Array([0, 97, 115, 109]) : 'worker']),
  )
  return { worker, scope }
}
beforeEach(() => vi.clearAllMocks())
describe('worker lifetime', () => {
  it('transfers installed bytes and releases worker on success', async () => {
    const { worker, scope } = setup(),
      progress = vi.fn()
    const result = runTraining(snapshot(), { signal: new AbortController().signal, progress })
    await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledOnce())
    expect(worker.postMessage.mock.calls[0]![1]).toHaveLength(1)
    worker.onmessage!({ data: { type: 'progress', current: 1, total: 2 } })
    worker.onmessage!({
      data: { type: 'result', weights: Array(21).fill(1), engine: TRAINING_ENGINE },
    })
    expect((await result).weights).toHaveLength(21)
    expect(progress).toHaveBeenCalledWith({ current: 1, total: 2 })
    expect(scope.signal.aborted).toBe(true)
    expect(worker.terminate).toHaveBeenCalledOnce()
  })
  it.each(['caller', 'plugin scope'])(
    'hard-cancels on %s abort and ignores late results',
    async (cause) => {
      const { worker, scope } = setup(),
        controller = new AbortController(),
        progress = vi.fn()
      const result = runTraining(snapshot(), { signal: controller.signal, progress })
      const failed = expect(result).rejects.toMatchObject({ name: 'AbortError' })
      await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledOnce())
      if (cause === 'caller') controller.abort()
      else scope.dispose()
      await failed
      worker.onmessage!({ data: { type: 'progress', current: 1, total: 2 } })
      worker.onmessage!({
        data: { type: 'result', weights: Array(21).fill(1), engine: TRAINING_ENGINE },
      })
      expect(progress).not.toHaveBeenCalled()
      expect(worker.terminate).toHaveBeenCalledOnce()
    },
  )
  it('rejects a malformed or wrong-version result', async () => {
    const { worker } = setup()
    const result = runTraining(snapshot(), {
      signal: new AbortController().signal,
      progress: vi.fn(),
    })
    const failed = expect(result).rejects.toThrow('invalid-trained-parameters')
    await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledOnce())
    worker.onmessage!({
      data: { type: 'result', weights: Array(23).fill(1), engine: TRAINING_ENGINE },
    })
    await failed
    expect(worker.terminate).toHaveBeenCalledOnce()
  })
})
