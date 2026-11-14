import type { MaterialSearchHit, MaterialSearchPage } from '@repeaty/plugin-api'
import type { Source } from '../core/source-data'
import { resolveWikiTarget } from '../core/wiki-links'
import type {
  IndexedMaterial,
  KnowledgeRequest,
  SynonymGroups,
  WikiContext,
} from '../core/material-search'

export interface KnowledgeTransport {
  call<T>(request: KnowledgeRequest, signal: AbortSignal): Promise<T>
  dispose(): void
}
const aborted = () => new DOMException('Aborted', 'AbortError')
function workerTransport(): KnowledgeTransport {
  const worker = new Worker(new URL('../core/material-knowledge.worker.ts', import.meta.url), {
    type: 'module',
  })
  let sequence = 0,
    closed = false
  const pending = new Map<
    number,
    { resolve(value: unknown): void; reject(error: unknown): void; clean(): void }
  >()
  const dispose = (error: unknown = aborted()) => {
    if (closed) return
    closed = true
    worker.terminate()
    worker.onmessage = null
    worker.onerror = null
    worker.onmessageerror = null
    for (const item of pending.values()) {
      item.clean()
      item.reject(error)
    }
    pending.clear()
  }
  worker.onerror = (event) => {
    event.preventDefault()
    dispose(new Error('材料检索暂时不可用，请重建索引。'))
  }
  worker.onmessageerror = () => dispose(new Error('材料检索暂时不可用，请重建索引。'))
  worker.onmessage = ({ data }: MessageEvent<{ id: number; value?: unknown; error?: string }>) => {
    const request = pending.get(data.id)
    if (!request) return
    pending.delete(data.id)
    request.clean()
    if (data.error) request.reject(new Error(data.error))
    else request.resolve(data.value)
  }
  return {
    dispose,
    call<T>(request: KnowledgeRequest, signal: AbortSignal): Promise<T> {
      if (closed || signal.aborted) return Promise.reject(aborted())
      return new Promise((resolve, reject) => {
        const id = ++sequence
        const abort = () => {
          const item = pending.get(id)
          item?.clean()
          pending.delete(id)
          reject(aborted())
        }
        const timer = setTimeout(() => dispose(new Error('材料检索超时，请重建索引。')), 30_000)
        signal.addEventListener('abort', abort, { once: true })
        pending.set(id, {
          resolve: resolve as (value: unknown) => void,
          reject,
          clean: () => {
            clearTimeout(timer)
            signal.removeEventListener('abort', abort)
          },
        })
        try {
          worker.postMessage({ id, request })
        } catch (error) {
          dispose(error)
        }
      })
    },
  }
}
export interface KnowledgeOptions {
  sources(): readonly Source[]
  scope(): string
  read(id: string, signal?: AbortSignal, mediaId?: string): Promise<string>
}
export interface KnowledgeTask {
  signal?: AbortSignal
  progress?(done: number, total: number): void
}

/** Lazy, per-library index. Metadata changes never trigger reads until an explicit query. */
export function createMaterialKnowledge(
  options: KnowledgeOptions,
  factory: () => KnowledgeTransport = workerTransport,
) {
  const scope = options.scope(),
    lifetime = new AbortController()
  let transport: KnowledgeTransport | undefined,
    tail: Promise<unknown> = Promise.resolve()
  const indexed = new Map<string, string>()
  const current = () => {
    if (lifetime.signal.aborted || scope !== options.scope()) throw aborted()
  }
  const metadata = (): IndexedMaterial[] =>
    options.sources().map(({ id, mediaId, title, format }) => ({ id, mediaId, title, format }))
  const signature = () => JSON.stringify(metadata())
  const call = <T>(request: KnowledgeRequest, signal: AbortSignal) => {
    current()
    signal.throwIfAborted()
    transport ??= factory()
    return transport.call<T>(request, signal)
  }
  async function result<T>(request: KnowledgeRequest, signal: AbortSignal) {
    const before = signature()
    const value = await call<T>(request, signal)
    if (before !== signature()) throw new Error('材料已变化，请重新搜索。')
    return value
  }
  async function sync(sources: IndexedMaterial[], signal: AbortSignal) {
    await call({ type: 'sync', sources }, signal)
    const versions = new Map(sources.map((source) => [source.id, source.mediaId]))
    for (const [id, version] of indexed) if (versions.get(id) !== version) indexed.delete(id)
  }
  async function prepare(signal: AbortSignal, progress?: KnowledgeTask['progress']) {
    current()
    const sources = metadata(),
      signature = JSON.stringify(sources)
    await sync(sources, signal)
    const changed = sources.filter((source) => indexed.get(source.id) !== source.mediaId)
    progress?.(0, changed.length)
    for (let offset = 0; offset < changed.length; offset += 4) {
      const batch = changed.slice(offset, offset + 4)
      const docs = await Promise.all(
        batch.map(async (source) => ({
          ...source,
          text: await options.read(source.id, signal, source.mediaId),
        })),
      )
      current()
      signal.throwIfAborted()
      if (signature !== JSON.stringify(metadata())) throw new Error('材料已变化，请重新搜索。')
      for (const document of docs) {
        await call({ type: 'put', document }, signal)
        indexed.set(document.id, document.mediaId)
      }
      progress?.(Math.min(offset + 4, changed.length), changed.length)
    }
    current()
    signal.throwIfAborted()
    if (signature !== JSON.stringify(metadata())) throw new Error('材料已变化，请重新搜索。')
  }
  function run<T>(task: KnowledgeTask, action: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController()
    const cancel = () => controller.abort()
    const parents = [lifetime.signal, ...(task.signal ? [task.signal] : [])]
    for (const signal of parents) {
      if (signal.aborted) cancel()
      else signal.addEventListener('abort', cancel, { once: true })
    }
    const result = tail
      .catch(() => {})
      .then(async () => {
        current()
        controller.signal.throwIfAborted()
        const value = await action(controller.signal)
        current()
        controller.signal.throwIfAborted()
        return value
      })
      .finally(() => {
        for (const signal of parents) signal.removeEventListener('abort', cancel)
      })
    tail = result
    return result
  }
  return {
    signature,
    search(
      text: string,
      groups: SynonymGroups = [],
      expand = true,
      offset = 0,
      task: KnowledgeTask = {},
    ) {
      return run(task, async (signal) => {
        await prepare(signal, task.progress)
        return result<MaterialSearchPage>(
          { type: 'search', text, groups, expand, offset, limit: 20 },
          signal,
        )
      })
    },
    context(sourceId: string, task: KnowledgeTask = {}) {
      return run(task, async (signal) => {
        await prepare(signal, task.progress)
        return result<WikiContext>({ type: 'context', sourceId }, signal)
      })
    },
    resolve(target: string) {
      current()
      return resolveWikiTarget(target, metadata())
    },
    preview(sourceId: string, task: KnowledgeTask = {}) {
      return run(task, async (signal) => {
        const sources = metadata(),
          before = JSON.stringify(sources),
          source = sources.find((item) => item.id === sourceId)
        if (!source) return undefined
        await sync(sources, signal)
        if (indexed.get(source.id) !== source.mediaId) {
          const text = await options.read(source.id, signal, source.mediaId)
          current()
          signal.throwIfAborted()
          if (before !== signature()) throw new Error('材料已变化，请重新搜索。')
          await call({ type: 'put', document: { ...source, text } }, signal)
          indexed.set(source.id, source.mediaId)
        }
        if (before !== signature()) throw new Error('材料已变化，请重新搜索。')
        return result<MaterialSearchHit | undefined>({ type: 'preview', sourceId }, signal)
      })
    },
    rebuild() {
      current()
      transport?.dispose()
      transport = undefined
      indexed.clear()
    },
    dispose() {
      lifetime.abort()
      transport?.dispose()
      transport = undefined
      indexed.clear()
    },
  }
}
export type MaterialKnowledge = ReturnType<typeof createMaterialKnowledge>
