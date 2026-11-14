import type { resources as ResourceApi } from '@repeaty/plugin-api'
import type { PluginAssets } from './assets'
import { pluginAssetPathSchema } from './assets'
import { supportsPluginWorkers } from './tasks'

/** Reader scopes own long-lived resources without holding a parser queue slot. */
export function createPluginResources(
  assets: PluginAssets | undefined,
  lifetime: AbortSignal,
  guard: () => void,
): typeof ResourceApi {
  const blobs = new Map<string, Blob>()
  lifetime.addEventListener('abort', () => blobs.clear(), { once: true })
  function read(path: string) {
    guard()
    pluginAssetPathSchema.parse(path)
    const asset = assets?.[path]
    if (!asset) return undefined
    let blob = blobs.get(path)
    if (!blob) {
      const binary = atob(asset.base64)
      const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
      blob = new Blob([bytes], { type: asset.type })
      blobs.set(path, blob)
    }
    return blob
  }
  return {
    read,
    createScope() {
      guard()
      const controller = new AbortController()
      const cleanups = new Set<() => void>()
      const urls = new Map<string, string>()
      const check = () => {
        guard()
        controller.signal.throwIfAborted()
      }
      const dispose = () => {
        if (controller.signal.aborted) return
        controller.abort()
        lifetime.removeEventListener('abort', dispose)
        for (const stop of cleanups) {
          try {
            stop()
          } catch {
            /* Release every resource. */
          }
        }
        cleanups.clear()
        urls.clear()
      }
      lifetime.addEventListener('abort', dispose, { once: true })
      function onCleanup(stop: () => void) {
        if (controller.signal.aborted) stop()
        else cleanups.add(stop)
      }
      return {
        signal: controller.signal,
        dispose,
        onCleanup,
        createWorker(source, options = {}) {
          check()
          if (!supportsPluginWorkers()) throw new Error('当前环境不支持插件后台解析。')
          if (
            typeof source !== 'string' ||
            !source.trim() ||
            new TextEncoder().encode(source).length > 4 * 1024 * 1024 ||
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
          onCleanup(() => {
            try {
              worker.terminate()
            } finally {
              URL.revokeObjectURL(url)
            }
          })
          return worker
        },
        url(path) {
          check()
          if (urls.has(path)) return urls.get(path)!
          const blob = read(path)
          if (!blob) throw new Error('插件资源不存在。')
          const url = URL.createObjectURL(blob)
          urls.set(path, url)
          onCleanup(() => URL.revokeObjectURL(url))
          return url
        },
      }
    },
  }
}
