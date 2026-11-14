import { initialize, unload } from './browser-api'
import { runTraining } from '../src/runner'
import { snapshot } from './fixture'

const workers = new Set<Worker>(),
  urls = new Set<string>()
const NativeWorker = window.Worker,
  createURL = URL.createObjectURL.bind(URL),
  revokeURL = URL.revokeObjectURL.bind(URL)
window.Worker = class extends NativeWorker {
  constructor(url: string | URL, options?: WorkerOptions) {
    super(url, options)
    workers.add(this)
  }
  override terminate() {
    workers.delete(this)
    super.terminate()
  }
}
URL.createObjectURL = (blob) => {
  const value = createURL(blob)
  urls.add(value)
  return value
}
URL.revokeObjectURL = (url) => {
  urls.delete(url)
  revokeURL(url)
}
await initialize()
let pulses = 0
const heartbeat = setInterval(() => {
  pulses++
}, 1)
const api = {
  async train(cancel: 'none' | 'caller' | 'scope' = 'none') {
    const before = pulses,
      started = performance.now(),
      controller = new AbortController()
    const pending = runTraining(snapshot(), { signal: controller.signal, progress() {} })
    if (cancel !== 'none') {
      const poll = setInterval(() => {
        if (!workers.size) return
        clearInterval(poll)
        if (cancel === 'caller') controller.abort()
        else unload()
      }, 1)
    }
    try {
      const result = await pending
      return { ...result, elapsed: performance.now() - started, pulses: pulses - before }
    } catch (error) {
      return {
        cancelled: error instanceof DOMException && error.name === 'AbortError',
        pulses: pulses - before,
      }
    }
  },
  initialize,
  get active() {
    return { workers: workers.size, urls: urls.size }
  },
  dispose() {
    clearInterval(heartbeat)
    unload()
  },
}
Object.assign(window, { optimizerTest: api })
document.getElementById('status')!.textContent = 'ready'
