import { localDateKey } from './review-days'

/** Re-check after sleep/background throttling and own every timer and event registration. */
export function startDayClock(changed: (date: Date) => void) {
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let previous = ''
  const refresh = () => {
    if (stopped) return
    clearTimeout(timer)
    const now = new Date()
    const current = `${localDateKey(now)}:${now.getTimezoneOffset()}`
    if (current !== previous) {
      previous = current
      changed(now)
    }
    const next = new Date(now)
    next.setHours(24, 0, 0, 0)
    timer = setTimeout(refresh, Math.max(1, next.getTime() - now.getTime() + 20))
  }
  const visible = () => {
    if (document.visibilityState === 'visible') refresh()
  }
  window.addEventListener('focus', refresh)
  document.addEventListener('visibilitychange', visible)
  refresh()
  return () => {
    stopped = true
    clearTimeout(timer)
    window.removeEventListener('focus', refresh)
    document.removeEventListener('visibilitychange', visible)
  }
}
