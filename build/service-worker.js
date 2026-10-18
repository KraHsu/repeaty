/* Build replaces these placeholders with this release's complete application shell. */
const FILES = __PRECACHE_FILES__
const VERSION = __CACHE_VERSION__
const PREFIX = 'repeaty-shell-' + encodeURIComponent(self.registration.scope) + '-'
const CACHE = PREFIX + VERSION
const url = (path) => new URL(path, self.registration.scope).href
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const cache = await caches.open(CACHE)
        await cache.addAll(FILES.map((path) => new Request(url(path), { cache: 'reload' })))
      } catch (error) {
        await caches.delete(CACHE)
        throw error
      }
    })(),
  )
})
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys())
        if (key.startsWith(PREFIX) && key !== CACHE) await caches.delete(key)
      await self.clients.claim()
    })(),
  )
})
self.addEventListener('message', (event) => {
  if (event.data?.type === 'ACTIVATE_UPDATE') self.skipWaiting()
})
self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET' || !request.url.startsWith(self.registration.scope)) return
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE)
      if (request.mode === 'navigate') {
        const shell = await cache.match(url('index.html'))
        if (shell) return shell
      }
      const cached = await cache.match(request, { ignoreSearch: true })
      return cached ?? fetch(request)
    })(),
  )
})
