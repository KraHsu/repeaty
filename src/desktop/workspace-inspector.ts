import type { FileChange } from '../workspace/changes'
import { previewPatch, type PreviewScan } from '../workspace/preview'
export interface Inspector {
  inspect(scan: PreviewScan): Promise<FileChange[]>
  dispose(): void
}
/** Parse YAML off the UI thread and transfer only changed file bodies after the first scan. */
export function createInspector(): Inspector {
  let worker: Worker | undefined,
    sequence = 0
  const pending = new Map<
    number,
    { resolve(value: FileChange[]): void; reject(error: Error): void }
  >()
  let previous: PreviewScan | undefined
  function dispose() {
    worker?.terminate()
    worker = undefined
    previous = undefined
    for (const request of pending.values()) request.reject(new Error('workspace-unavailable'))
    pending.clear()
  }
  return {
    inspect(scan) {
      if (!worker) {
        worker = new Worker(new URL('../workspace/preview.worker.ts', import.meta.url), {
          type: 'module',
        })
        worker.onmessage = (
          event: MessageEvent<{ id: number; changes?: FileChange[]; error?: string }>,
        ) => {
          const request = pending.get(event.data.id)
          if (!request) return
          pending.delete(event.data.id)
          if (event.data.changes) request.resolve(event.data.changes)
          else request.reject(new Error(event.data.error ?? 'invalid-scan'))
        }
        worker.onerror = dispose
        worker.onmessageerror = dispose
      }
      const id = ++sequence
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject })
        try {
          worker!.postMessage(
            previous?.token === scan.token
              ? { id, patch: previewPatch(previous, scan) }
              : { id, scan },
          )
          previous = scan
        } catch (error) {
          pending.delete(id)
          reject(error)
        }
      })
    },
    dispose,
  }
}
