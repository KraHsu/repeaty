import { afterEach, expect, it, vi } from 'vitest'
import type { MaterialTaskContext } from '@repeaty/plugin-api'
import { tasks } from '../test/plugin-api'
import { runCleanup } from './run-cleanup'
afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})
const options = { trimTrailing: true, collapseBlankLines: true, normalizeIndent: true, rules: [] }
function setup() {
  const worker = {
    postMessage: vi.fn(),
    terminate: vi.fn(),
    onmessage: null as null | ((event: { data: unknown }) => void),
    onerror: null as null | (() => void),
  }
  const controller = new AbortController(),
    cleanup: (() => void)[] = []
  tasks.run.mockImplementation((_options, run: (context: MaterialTaskContext) => Promise<string>) =>
    run({
      signal: controller.signal,
      progress: () => {},
      yield: async () => {},
      onCleanup: (stop) => cleanup.push(stop),
      createWorker: () => worker as unknown as Worker,
    }),
  )
  return { worker, controller, cleanup }
}
it('returns worker results and terminates worker resources', async () => {
  const { worker, cleanup } = setup(),
    result = runCleanup('foo ', options)
  worker.onmessage!({ data: { text: 'foo' } })
  expect(await result).toBe('foo')
  cleanup.forEach((stop) => stop())
  expect(worker.terminate).toHaveBeenCalledTimes(1)
})
it('terminates pathological regular expressions after the bounded timeout', async () => {
  vi.useFakeTimers()
  const { worker } = setup(),
    result = runCleanup('foo', options)
  const rejection = expect(result).rejects.toThrow('超过 2 秒')
  await vi.advanceTimersByTimeAsync(2000)
  await rejection
  expect(worker.terminate).toHaveBeenCalledTimes(1)
})
it('cancels on scope/plugin lifetime changes without returning stale output', async () => {
  const { worker, controller } = setup(),
    result = runCleanup('foo', options)
  const rejection = expect(result).rejects.toMatchObject({ name: 'AbortError' })
  controller.abort()
  worker.onmessage!({ data: { text: 'late' } })
  await rejection
  expect(worker.terminate).toHaveBeenCalledTimes(1)
})
