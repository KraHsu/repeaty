import { createInstance } from '@open-spaced-repetition/binding-wasm32-wasip1/workerd'
import { train, type TrainingInput } from './training'

// The packaged worker never fetches a URL: the host transfers installed WASM bytes.
let started = false
self.onmessage = async (event: MessageEvent<{ wasm: ArrayBuffer; input: TrainingInput }>) => {
  if (started) return
  started = true
  let instance: Awaited<ReturnType<typeof createInstance>> | undefined
  try {
    const { wasm, input } = event.data
    if (!(wasm instanceof ArrayBuffer) || !wasm.byteLength || wasm.byteLength > 4 * 1024 * 1024)
      throw new Error('optimizer-asset-invalid')
    instance = await createInstance(await WebAssembly.compile(wasm), {
      initialMemoryPages: 1024,
      maximumMemoryPages: 8192,
    })
    const result = await train(instance.exports, input, (current, total) =>
      self.postMessage({ type: 'progress', current, total }),
    )
    self.postMessage({ type: 'result', ...result })
  } catch (error) {
    self.postMessage({
      type: 'error',
      code: error instanceof Error ? error.message : 'optimizer-failed',
    })
  } finally {
    await instance?.dispose()
  }
}
