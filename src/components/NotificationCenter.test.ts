// @vitest-environment happy-dom
import { createApp, nextTick } from 'vue'
import { expect, it, vi } from 'vitest'
import NotificationCenter from './NotificationCenter.vue'
import { notify, clearNotifications, dismissNotificationContext } from '../notifications'
import { restorePreferences, setPreference } from '../preferences'
import { setLocale } from '../i18n'

it('expires only info, pauses its timer on hover, and keeps warnings/errors dismissible when popups are disabled', async () => {
  vi.useFakeTimers()
  localStorage.clear()
  restorePreferences()
  clearNotifications()
  setLocale('en')
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp(NotificationCenter)
  app.mount(host)
  try {
    notify('Information')
    notify('Warning', 'warning', 'review-1')
    notify('Error', 'error')
    notify('Error', 'error')
    await nextTick()
    expect(host.querySelectorAll('[role=alert]')).toHaveLength(2)
    const info = host.querySelector<HTMLElement>('[role=status]')!
    await vi.advanceTimersByTimeAsync(2000)
    info.dispatchEvent(new MouseEvent('mouseenter'))
    await vi.advanceTimersByTimeAsync(10_000)
    expect(host.querySelector('[role=status]')).not.toBeNull()
    info.dispatchEvent(new MouseEvent('mouseleave'))
    await vi.advanceTimersByTimeAsync(3000)
    await nextTick()
    expect(host.querySelector('[role=status]')).toBeNull()
    expect(host.querySelectorAll('[role=alert]')).toHaveLength(2)
    setPreference('popupWarning', false)
    await nextTick()
    expect(host.querySelector('.inline-notifications')!.textContent).toContain('Warning')
    expect(host.querySelector('.notification-center')!.textContent).not.toContain('Warning')
    dismissNotificationContext('review-1')
    await nextTick()
    host.querySelector<HTMLButtonElement>('[role=alert] button')!.click()
    await nextTick()
    expect(host.querySelector('[role=alert]')).toBeNull()
  } finally {
    app.unmount()
    host.remove()
    clearNotifications()
    localStorage.clear()
    restorePreferences()
    setLocale('zh-CN')
    vi.useRealTimers()
  }
})
