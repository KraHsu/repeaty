import type {
  MaterialTaskContext,
  MaterialTaskOptions,
  MaterialTaskProgress,
} from '@repeaty/plugin-api'

export function cancelledTask(): Error {
  return new DOMException('插件任务已取消。', 'AbortError')
}
export function supportsPluginWorkers(): boolean {
  return (
    typeof Worker === 'function' &&
    typeof Blob === 'function' &&
    typeof URL.createObjectURL === 'function' &&
    typeof URL.revokeObjectURL === 'function'
  )
}
const retainPendingWork = Symbol('plugin-task-pending-work')
/** Internal wrappers can reject a cancelled call early while retaining its actual queue slot. */
export function retainTaskWork(context: MaterialTaskContext, work: Promise<unknown>) {
  ;(context as MaterialTaskContext & { [retainPendingWork]?: (work: Promise<unknown>) => void })[
    retainPendingWork
  ]?.(work)
}

/** Application-owned bounded queue. No component, Pinia store, or library data is retained here. */
export class PluginTaskScheduler {
  private active = 0
  private queue: (() => void)[] = []
  private identities = new Map<symbol, Set<string>>()
  constructor(
    private readonly concurrency = 2,
    private readonly queueLimit = 16,
  ) {}

  run<T>(
    owner: symbol,
    options: MaterialTaskOptions,
    run: (context: MaterialTaskContext) => Promise<T>,
    lifetime: AbortSignal,
  ): Promise<T> {
    if (!options || !/^[a-z][a-z0-9-]{0,63}$/.test(options.id) || !options.title?.trim())
      return Promise.reject(new Error('插件任务定义无效。'))
    // Symbols identify activations, so a replacement cannot collide with a retired instance.
    const owned = this.identities.get(owner) ?? new Set<string>()
    if (owned.has(options.id)) return Promise.reject(new Error('插件任务标识正在使用。'))
    if (lifetime.aborted || options.signal?.aborted) return Promise.reject(cancelledTask())
    if (this.active >= this.concurrency && this.queue.length >= this.queueLimit)
      return Promise.reject(new Error('插件任务队列已满。'))
    owned.add(options.id)
    this.identities.set(owner, owned)
    return new Promise<T>((resolve, reject) => {
      const controller = new AbortController()
      const cleanups = new Set<() => void>()
      const pendingWork = new Set<Promise<unknown>>()
      let started = false,
        settled = false
      const cleanup = () => {
        for (const stop of cleanups) {
          try {
            stop()
          } catch {
            /* continue other resources */
          }
        }
        cleanups.clear()
      }
      const detach = () => {
        lifetime.removeEventListener('abort', abort)
        options.signal?.removeEventListener('abort', abort)
      }
      const finish = (success: boolean, value: unknown) => {
        if (settled) return
        settled = true
        detach()
        cleanup()
        owned.delete(options.id)
        if (!owned.size) this.identities.delete(owner)
        if (success) resolve(value as T)
        else reject(value)
      }
      const abort = () => {
        controller.abort()
        if (!started) {
          const index = this.queue.indexOf(start)
          if (index !== -1) this.queue.splice(index, 1)
        }
        finish(false, cancelledTask())
      }
      const check = () => {
        if (settled || controller.signal.aborted) throw cancelledTask()
      }
      const context: MaterialTaskContext & {
        [retainPendingWork]: (work: Promise<unknown>) => void
      } = {
        [retainPendingWork](work) {
          const settled = work.catch(() => undefined)
          pendingWork.add(settled)
          void settled.then(() => pendingWork.delete(settled))
        },
        signal: controller.signal,
        progress(value: MaterialTaskProgress) {
          check()
          if (
            !Number.isFinite(value.completed) ||
            value.completed < 0 ||
            (value.total !== undefined &&
              (!Number.isFinite(value.total) || value.total < value.completed)) ||
            (value.message !== undefined &&
              (typeof value.message !== 'string' || value.message.length > 1000))
          )
            throw new Error('插件任务进度无效。')
          options.onProgress?.(Object.freeze({ ...value }))
        },
        onCleanup(stop) {
          if (settled) {
            stop()
            return
          }
          cleanups.add(stop)
        },
        createWorker(source, options = {}) {
          check()
          if (!supportsPluginWorkers()) throw new Error('当前环境不支持插件后台解析。')
          if (
            typeof source !== 'string' ||
            !source.trim() ||
            source.length > 4 * 1024 * 1024 ||
            new TextEncoder().encode(source).byteLength > 4 * 1024 * 1024 ||
            !options ||
            (options.type !== undefined && !['classic', 'module'].includes(options.type)) ||
            (options.name !== undefined &&
              (typeof options.name !== 'string' || options.name.length > 100))
          )
            throw new Error('插件 Worker 定义无效或超过4 MB。')
          const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }))
          let worker: Worker
          try {
            worker = new Worker(url, { type: options.type ?? 'classic', name: options.name })
          } catch (error) {
            URL.revokeObjectURL(url)
            throw error
          }
          let disposed = false
          context.onCleanup(() => {
            if (disposed) return
            disposed = true
            try {
              worker.terminate()
            } finally {
              URL.revokeObjectURL(url)
            }
          })
          check()
          return worker
        },
        async yield() {
          check()
          await new Promise<void>((resolve) => setTimeout(resolve, 0))
          check()
        },
      }
      const start = () => {
        if (settled) return
        started = true
        this.active++
        Promise.resolve()
          .then(() => {
            check()
            return run(context)
          })
          .then(
            (value) => {
              if (!controller.signal.aborted) finish(true, value)
            },
            (error) => finish(false, error),
          )
          .finally(async () => {
            // A parser which ignores cancellation keeps its slot until it really returns.
            while (pendingWork.size) await Promise.all([...pendingWork])
            this.active--
            this.queue.shift()?.()
          })
      }
      lifetime.addEventListener('abort', abort, { once: true })
      options.signal?.addEventListener('abort', abort, { once: true })
      if (this.active < this.concurrency) start()
      else this.queue.push(start)
    })
  }
}
