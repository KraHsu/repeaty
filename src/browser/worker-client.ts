import { WorkspaceReadError } from './errors'
import type { WorkspaceRequest, WorkspaceReply } from './workspace.worker'
import type { WorkspaceSelection } from './workspace-files'
import type { BrowserWorkspaceSnapshot } from './workspace-reader'
import type { BrowserWorkspaceSource } from './repository'

/** One worker owns each selected snapshot and is terminated on cancellation or close. */
export async function readBrowserWorkspace(
  selection: WorkspaceSelection,
  signal: AbortSignal,
  progress: (percent: number) => void,
): Promise<BrowserWorkspaceSource> {
  signal.throwIfAborted()
  let worker: Worker
  try {
    worker = new Worker(new URL('./workspace.worker.ts', import.meta.url), { type: 'module' })
  } catch {
    throw new WorkspaceReadError('unavailable')
  }
  let sequence = 0,
    closed = false
  const pending = new Map<
    number,
    {
      resolve(value: unknown): void
      reject(error: unknown): void
      timer: ReturnType<typeof setTimeout>
    }
  >()
  function close(error: unknown = new WorkspaceReadError('closed')) {
    if (closed) return
    closed = true
    signal.removeEventListener('abort', abort)
    worker.onmessage = null
    worker.onerror = null
    worker.onmessageerror = null
    worker.terminate()
    for (const request of pending.values()) {
      clearTimeout(request.timer)
      request.reject(error)
    }
    pending.clear()
  }
  const abort = () => close(signal.reason ?? new DOMException('Aborted', 'AbortError'))
  signal.addEventListener('abort', abort, { once: true })
  const unavailable = () => close(new WorkspaceReadError('unavailable'))
  worker.onerror = (event) => {
    event.preventDefault()
    unavailable()
  }
  worker.onmessageerror = unavailable
  worker.onmessage = ({ data }: MessageEvent<WorkspaceReply>) => {
    const request = pending.get(data.id)
    if (!request) return
    if (data.type === 'progress') {
      progress(data.percent)
      return
    }
    clearTimeout(request.timer)
    pending.delete(data.id)
    if (data.type === 'error') request.reject(new WorkspaceReadError(data.code))
    else request.resolve(data.value)
  }
  function call<T>(request: WorkspaceRequest): Promise<T> {
    if (closed) return Promise.reject(new WorkspaceReadError('closed'))
    return new Promise((resolve, reject) => {
      const id = ++sequence
      const timer = setTimeout(unavailable, request.type === 'open' ? 120_000 : 30_000)
      pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer })
      try {
        worker.postMessage({ id, request })
      } catch {
        unavailable()
      }
    })
  }
  try {
    const snapshot = await call<BrowserWorkspaceSnapshot>({ type: 'open', selection })
    signal.throwIfAborted()
    signal.removeEventListener('abort', abort)
    return {
      snapshot,
      media: (id) => call<Blob | undefined>({ type: 'media', id }),
      attempts: (ids) => call({ type: 'attempts', ids }),
      close,
    }
  } catch (error) {
    close(error)
    throw error
  }
}
