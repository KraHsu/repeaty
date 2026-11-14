import { resources, type StudyTrainingSnapshot } from '@repeaty/plugin-api'
import { TRAINING_ENGINE } from './training'

export interface TrainingProgress {
  current: number
  total: number
}
export type RunTraining = (
  snapshot: StudyTrainingSnapshot,
  options: { signal: AbortSignal; progress(value: TrainingProgress): void },
) => Promise<{ weights: number[]; engine: string }>

function cancelled() {
  return new DOMException('Training cancelled', 'AbortError')
}

/** Termination interrupts synchronous WASM too, without waiting for its event loop. */
export const runTraining: RunTraining = async (snapshot, options) => {
  options.signal.throwIfAborted()
  const scope = resources.createScope()
  const abort = () => scope.dispose()
  options.signal.addEventListener('abort', abort, { once: true })
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    const source = resources.read('optimizer.worker.mjs')
    const binary = resources.read('optimizer.wasm')
    if (!source || !binary) throw new Error('optimizer-asset-missing')
    const [code, wasm] = await Promise.all([source.text(), binary.arrayBuffer()])
    options.signal.throwIfAborted()
    scope.signal.throwIfAborted()
    const worker = scope.createWorker(code, { type: 'module', name: 'repeaty-fsrs-optimizer' })
    return await new Promise((resolve, reject) => {
      const stop = () => reject(cancelled())
      scope.signal.addEventListener('abort', stop, { once: true })
      scope.onCleanup(() => scope.signal.removeEventListener('abort', stop))
      worker.onmessage = (event: MessageEvent) => {
        if (scope.signal.aborted || options.signal.aborted) return
        const value = event.data
        if (value?.type === 'progress') {
          if (
            Number.isFinite(value.current) &&
            Number.isFinite(value.total) &&
            value.total > 0 &&
            value.current >= 0 &&
            value.current <= value.total
          )
            options.progress({ current: value.current, total: value.total })
        } else if (value?.type === 'result') {
          if (
            value.engine !== TRAINING_ENGINE ||
            !Array.isArray(value.weights) ||
            value.weights.length !== 21 ||
            value.weights.some(
              (weight: unknown) => typeof weight !== 'number' || !Number.isFinite(weight),
            )
          )
            reject(new Error('invalid-trained-parameters'))
          else resolve({ weights: value.weights, engine: value.engine })
        } else if (value?.type === 'error') reject(new Error(String(value.code)))
      }
      worker.onerror = () => reject(new Error('optimizer-worker-failed'))
      worker.onmessageerror = () => reject(new Error('optimizer-worker-failed'))
      timeout = setTimeout(() => {
        reject(new Error('optimizer-timeout'))
        scope.dispose()
      }, 120_000)
      worker.postMessage(
        {
          wasm,
          input: {
            modelVersion: snapshot.modelVersion,
            enableShortTerm: snapshot.enableShortTerm,
            histories: snapshot.histories,
            cutoff: snapshot.cutoff,
          },
        },
        [wasm],
      )
    })
  } finally {
    clearTimeout(timeout)
    options.signal.removeEventListener('abort', abort)
    scope.dispose()
  }
}
