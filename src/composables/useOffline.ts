import { onMounted, onUnmounted, readonly, ref } from 'vue'

export function useOffline() {
  const status = ref(import.meta.env.PROD ? '正在准备离线资源…' : '开发模式：未启用离线启动')
  const updateReady = ref(false)
  let registration: ServiceWorkerRegistration | undefined
  let applying = false,
    disposed = false
  function controllerChanged() {
    if (applying) window.location.reload()
  }
  onMounted(async () => {
    if (!import.meta.env.PROD) return
    if (!('serviceWorker' in navigator)) {
      status.value = '当前环境不支持离线启动，请使用 HTTPS 或 localhost'
      return
    }
    navigator.serviceWorker.addEventListener('controllerchange', controllerChanged)
    try {
      registration = await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`)
      if (disposed) return
      updateReady.value = Boolean(registration.waiting)
      const observe = (worker: ServiceWorker) =>
        worker.addEventListener('statechange', () => {
          if (disposed) return
          if (worker.state === 'installed')
            updateReady.value = Boolean(navigator.serviceWorker.controller)
          if (worker.state === 'redundant' && !registration?.active)
            status.value = '离线资源准备失败，请联网刷新重试'
        })
      if (registration.installing) observe(registration.installing)
      registration.addEventListener('updatefound', () => {
        if (registration?.installing) observe(registration.installing)
      })
      await navigator.serviceWorker.ready
      if (!disposed) status.value = '离线已就绪'
    } catch {
      if (!disposed) status.value = '离线资源准备失败，请联网刷新重试'
    }
  })
  onUnmounted(() => {
    disposed = true
    navigator.serviceWorker?.removeEventListener('controllerchange', controllerChanged)
  })
  return {
    status: readonly(status),
    updateReady: readonly(updateReady),
    applyUpdate() {
      if (registration?.waiting) {
        applying = true
        registration.waiting.postMessage({ type: 'ACTIVATE_UPDATE' })
      }
    },
  }
}
