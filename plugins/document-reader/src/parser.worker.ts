import { parseEpub, parseHtml } from './parse'
import type { RelatedFile } from './model'

interface Request {
  kind: 'epub' | 'html'
  bytes: Uint8Array
  path: string
  related: RelatedFile[]
}
const worker = globalThis as unknown as {
  onmessage: (event: MessageEvent<Request>) => void
  postMessage: (data: unknown) => void
}
worker.onmessage = async ({ data }) => {
  try {
    const context = {
      progress: (completed: number, total: number, message: string) =>
        worker.postMessage({ type: 'progress', completed, total, message }),
    }
    const book =
      data.kind === 'epub'
        ? await parseEpub(data.bytes, data.path, context)
        : await parseHtml(data.bytes, data.path, data.related, context)
    worker.postMessage({ type: 'done', book })
  } catch (error) {
    worker.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    })
  }
}
