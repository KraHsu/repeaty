import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

interface WorkerEvent {
  request?: Request
  data?: { type: string }
  waitUntil: (task: Promise<unknown>) => void
  respondWith: (task: Promise<Response>) => void
}
function workerHarness(failAsset = false) {
  const scope = 'https://repeaty.example/app/'
  const prefix = `repeaty-shell-${encodeURIComponent(scope)}-`
  const buckets = new Map<string, Map<string, Response>>([
    [`${prefix}old`, new Map()],
    ['unrelated', new Map()],
  ])
  const handlers = new Map<string, (event: WorkerEvent) => void>()
  let online = true,
    claimed = false,
    activated = false
  const fetch = async (request: Request) => {
    if (!online || (failAsset && request.url.endsWith('main.js'))) throw new Error('offline')
    return new Response(request.url.endsWith('index.html') ? '<html>repeaty</html>' : 'asset')
  }
  const caches = {
    async open(key: string) {
      if (!buckets.has(key)) buckets.set(key, new Map())
      const cache = buckets.get(key)!
      return {
        async addAll(requests: Request[]) {
          const responses = await Promise.all(requests.map(fetch))
          requests.forEach((request, index) => cache.set(request.url, responses[index]!))
        },
        async match(request: string | Request, options?: { ignoreSearch: boolean }) {
          let key = typeof request === 'string' ? request : request.url
          if (options?.ignoreSearch) key = key.split('?')[0]!
          return cache.get(key)?.clone()
        },
      }
    },
    async keys() {
      return [...buckets.keys()]
    },
    async delete(key: string) {
      return buckets.delete(key)
    },
  }
  const source = readFileSync(new URL('../../build/service-worker.js', import.meta.url), 'utf8')
    .replace('__PRECACHE_FILES__', JSON.stringify(['index.html', 'main.js']))
    .replace('__CACHE_VERSION__', JSON.stringify('new'))
  runInNewContext(source, {
    URL,
    Request,
    Response,
    encodeURIComponent,
    caches,
    fetch,
    self: {
      registration: { scope },
      clients: {
        async claim() {
          claimed = true
        },
      },
      skipWaiting() {
        activated = true
      },
      addEventListener(type: string, handler: (event: WorkerEvent) => void) {
        handlers.set(type, handler)
      },
    },
  })
  async function dispatch(type: string, extra: Partial<WorkerEvent> = {}) {
    let result: Promise<unknown> = Promise.resolve()
    handlers.get(type)!({
      ...extra,
      waitUntil(task) {
        result = task
      },
      respondWith(task) {
        result = task
      },
    })
    return await result
  }
  return {
    dispatch,
    buckets,
    prefix,
    offline() {
      online = false
    },
    claimed: () => claimed,
    activated: () => activated,
  }
}

describe('production offline shell lifecycle', () => {
  it('serves navigation and cached assets with no network after installation', async () => {
    const worker = workerHarness()
    await worker.dispatch('install')
    expect(worker.activated()).toBe(false)
    await worker.dispatch('activate')
    worker.offline()
    const navigation = new Request('https://repeaty.example/app/?page=cards')
    Object.defineProperty(navigation, 'mode', { value: 'navigate' })
    const response = (await worker.dispatch('fetch', { request: navigation })) as Response
    expect(await response.text()).toContain('repeaty')
    const asset = (await worker.dispatch('fetch', {
      request: new Request('https://repeaty.example/app/main.js'),
    })) as Response
    expect(await asset.text()).toBe('asset')
    expect(worker.claimed()).toBe(true)
    expect(worker.buckets.has('unrelated')).toBe(true)
    expect(worker.buckets.has(worker.prefix + 'old')).toBe(false)
  })
  it('keeps the previous cache when any release asset fails to download', async () => {
    const worker = workerHarness(true)
    await expect(worker.dispatch('install')).rejects.toThrow('offline')
    expect(worker.buckets.has(worker.prefix + 'old')).toBe(true)
    expect(worker.buckets.has(worker.prefix + 'new')).toBe(false)
  })
  it('only activates an update on the explicit application message', async () => {
    const worker = workerHarness()
    await worker.dispatch('message', { data: { type: 'unrelated' } })
    expect(worker.activated()).toBe(false)
    await worker.dispatch('message', { data: { type: 'ACTIVATE_UPDATE' } })
    expect(worker.activated()).toBe(true)
  })
})
