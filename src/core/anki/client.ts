import { LocalizedError, msg } from '../../i18n'
import { MAX_APKG_BYTES, type AnkiPackage } from './types'
import type { AnkiWorkerReply } from './worker'

/** A disposable worker releases SQLite's memory on completion or cancellation. */
export async function readAnkiFile(
  file: File,
  signal: AbortSignal,
  progress: (percent: number) => void,
): Promise<AnkiPackage> {
  signal.throwIfAborted()
  if (!file.size || file.size > MAX_APKG_BYTES)
    throw new LocalizedError(msg('Anki 文件不能超过 256 MB。'))
  return new Promise((resolve, reject) => {
    let worker: Worker
    try {
      worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
    } catch {
      reject(new LocalizedError(msg('无法启动 Anki 导入器，请重新加载页面后重试。')))
      return
    }
    const cleanup = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
      worker.onmessage = null
      worker.onerror = null
      worker.onmessageerror = null
      worker.terminate()
    }
    const abort = () => {
      cleanup()
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
    }
    const timer = setTimeout(() => {
      cleanup()
      reject(new LocalizedError(msg('Anki 文件处理超时，请拆分卡组后重试。')))
    }, 60_000)
    signal.addEventListener('abort', abort, { once: true })
    worker.onerror = (event) => {
      event.preventDefault()
      cleanup()
      reject(new LocalizedError(msg('无法启动 Anki 导入器，请重新加载页面后重试。')))
    }
    worker.onmessageerror = () => {
      cleanup()
      reject(new LocalizedError(msg('无法启动 Anki 导入器，请重新加载页面后重试。')))
    }
    worker.onmessage = ({ data }: MessageEvent<AnkiWorkerReply>) => {
      if (data.type === 'progress') {
        progress(Math.round(data.percent))
        return
      }
      cleanup()
      if (data.type === 'complete') resolve(data.data)
      else reject(new LocalizedError(data.error))
    }
    try {
      worker.postMessage({ file })
    } catch {
      cleanup()
      reject(new LocalizedError(msg('无法启动 Anki 导入器，请重新加载页面后重试。')))
    }
  })
}
