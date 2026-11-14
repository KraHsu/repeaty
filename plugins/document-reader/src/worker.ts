import { resources, type MaterialTaskContext } from '@repeaty/plugin-api'
import { limits, type DocumentBook, type RelatedFile } from './model'
import { cleanPath } from './path'

export async function readDocument(
  blob: Blob,
  kind: 'epub' | 'html',
  path: string,
  context: MaterialTaskContext,
): Promise<DocumentBook> {
  context.signal.throwIfAborted()
  if (blob.size > limits.fileBytes) throw new Error('文档超过 32 MiB，请拆分后导入。')
  const asset = resources.read('document-worker.js')
  if (!asset || !context.createWorker)
    throw new Error('当前宿主不支持文档后台读取，请更新 Repeaty 或重新安装插件。')
  const related: RelatedFile[] = []
  let total = blob.size
  if (kind === 'html')
    for (const file of context.files ?? []) {
      context.signal.throwIfAborted()
      total += file.size
      if (
        related.length >= limits.resources ||
        file.size > limits.entryBytes ||
        total > limits.totalBytes
      )
        throw new Error('HTML 配套资源超过大小限制。')
      related.push({
        path: cleanPath(file.webkitRelativePath || file.name),
        bytes: new Uint8Array(await file.arrayBuffer()),
        type: file.type,
      })
    }
  const source = await asset.text(),
    bytes = new Uint8Array(await blob.arrayBuffer())
  context.signal.throwIfAborted()
  const worker = context.createWorker(source, { type: 'module', name: 'repeaty-document-reader' })
  return new Promise<DocumentBook>((resolve, reject) => {
    let finished = false
    const finish = (error?: Error, book?: DocumentBook) => {
      if (finished) return
      finished = true
      clearTimeout(timeout)
      context.signal.removeEventListener('abort', abort)
      worker.onmessage = null
      worker.onerror = null
      worker.terminate()
      if (error) reject(error)
      else resolve(book!)
    }
    const abort = () => finish(new DOMException('文档读取已取消', 'AbortError'))
    const timeout = setTimeout(
      () => finish(new Error('文档读取超时，请检查文件或拆分后重试。')),
      120_000,
    )
    context.onCleanup(() => finish(new DOMException('文档读取已结束', 'AbortError')))
    context.signal.addEventListener('abort', abort, { once: true })
    worker.onerror = (event) => finish(new Error(event.message || '文档读取失败。'))
    worker.onmessage = ({ data }) => {
      if (context.signal.aborted) return abort()
      if (data.type === 'progress')
        context.progress({ completed: data.completed, total: data.total, message: data.message })
      else if (data.type === 'error') finish(new Error(data.message))
      else if (data.type === 'done') finish(undefined, data.book)
    }
    worker.postMessage({ kind, path, bytes, related }, [
      bytes.buffer,
      ...related.map((file) => file.bytes.buffer),
    ])
  })
}
