import { tasks } from '@repeaty/plugin-api'
import { cleanupText, type CleanupOptions } from './cleanup'

export function runCleanup(text: string, options: CleanupOptions, signal?: AbortSignal) {
  return tasks.run(
    { id: `cleanup-${crypto.randomUUID()}`, title: '预览格式清理', signal },
    async (context) => {
      if (!context.createWorker) throw new Error('当前环境不支持安全的后台清理任务。')
      const worker = context.createWorker(
        `const cleanup = ${cleanupText.toString()};
      self.onmessage = ({data}) => { try { self.postMessage({text: cleanup(data.text, data.options)}) }
        catch(error) { self.postMessage({error: error.message || String(error)}) } };`,
        { name: 'repeaty-format-cleanup' },
      )
      return new Promise<string>((resolve, reject) => {
        let finished = false
        const finish = (error?: Error, value?: string) => {
          if (finished) return
          finished = true
          clearTimeout(timer)
          context.signal.removeEventListener('abort', abort)
          worker.terminate()
          if (error) reject(error)
          else resolve(value!)
        }
        const abort = () => finish(new DOMException('已取消清理', 'AbortError'))
        const timer = setTimeout(
          () => finish(new Error('清理超过 2 秒，已停止。请简化正则或缩小规则范围。')),
          2000,
        )
        context.signal.addEventListener('abort', abort, { once: true })
        context.onCleanup(abort)
        worker.onmessage = ({ data }) => {
          if (typeof data?.text === 'string') finish(undefined, data.text)
          else finish(new Error(String(data?.error ?? '清理失败。')))
        }
        worker.onerror = () => finish(new Error('后台清理失败。'))
        worker.postMessage({ text, options })
      })
    },
  )
}
