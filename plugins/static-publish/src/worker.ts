import { resources, tasks, type MaterialTaskContext } from '@repeaty/plugin-api'
import type { generateSite } from './generate'
import type { SiteBuild, SiteFile } from './model'

async function work<T>(input: unknown, context: MaterialTaskContext): Promise<T> {
  const script = resources.read('publish-worker.js')
  if (!script || !context.createWorker) throw new Error('请更新 Repeaty 并重新安装静态发布插件。')
  const code = await script.text()
  context.signal.throwIfAborted()
  const worker = context.createWorker(code, { type: 'module', name: 'repeaty-publish' })
  return new Promise<T>((resolve, reject) => {
    let done = false
    const end = (error?: Error, value?: T) => {
      if (done) return
      done = true
      clearTimeout(timeout)
      context.signal.removeEventListener('abort', abort)
      worker.onmessage = null
      worker.onerror = null
      worker.terminate()
      if (error) reject(error)
      else resolve(value!)
    }
    const abort = () => end(new DOMException('已停止生成，之前的站点仍保留。', 'AbortError'))
    const timeout = setTimeout(
      () => end(new Error('生成超过两分钟，请减少材料或简化主题。')),
      120_000,
    )
    context.signal.addEventListener('abort', abort, { once: true })
    context.onCleanup(abort)
    worker.onerror = (event) => end(new Error(event.message || '后台生成失败。'))
    worker.onmessage = ({ data }) => {
      if (context.signal.aborted) return abort()
      if (data.type === 'error') end(new Error(data.message))
      else if (data.type === 'progress')
        context.progress({ completed: data.completed, total: data.total })
      else end(undefined, (data.type === 'zip' ? data.bytes : data.build) as T)
    }
    worker.postMessage(input)
  })
}
export function buildSite(
  input: Parameters<typeof generateSite>[0],
  signal: AbortSignal,
  onProgress: (completed: number, total: number) => void,
) {
  return tasks.run(
    {
      id: 'generate-site',
      title: '生成公开站点',
      signal,
      onProgress: (value) => onProgress(value.completed, value.total ?? 1),
    },
    (context) => work<SiteBuild>({ type: 'generate', input }, context),
  )
}
export function exportZip(files: SiteFile[], signal: AbortSignal) {
  return tasks.run(
    { id: 'export-site', title: '导出站点', signal },
    async (context) =>
      new Blob([new Uint8Array(await work<Uint8Array>({ type: 'zip', files }, context))], {
        type: 'application/zip',
      }),
  )
}
