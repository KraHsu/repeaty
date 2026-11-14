import { createPinia } from 'pinia'
// @vitest-environment happy-dom
import { createApp, nextTick } from 'vue'
import { afterEach, expect, it, vi } from 'vitest'
import NotificationCenter from './NotificationCenter.vue'
import { useNotifications } from '../notifications'
import { restorePreferences, setPreference } from '../preferences'
import { setLocale } from '../i18n'

const cleanups: Array<() => void> = []
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup())
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

async function settle() {
  await nextTick()
  await Promise.resolve()
  await nextTick()
}

function measuredElement(className: string, top: number, bottom: number) {
  const element = document.createElement('div')
  element.className = className
  let rect = new DOMRect(240, top, 1040, bottom - top)
  const measure = vi.spyOn(element, 'getBoundingClientRect').mockImplementation(() => rect)
  return {
    element,
    measure,
    move(nextTop: number, nextBottom: number) {
      rect = new DOMRect(240, nextTop, 1040, nextBottom - nextTop)
    },
  }
}

function positionedCenter(notifyImmediately = true) {
  const observers: Array<{
    targets: Set<Element>
    disconnected: boolean
    callback: ResizeObserverCallback
  }> = []
  vi.stubGlobal(
    'ResizeObserver',
    class {
      targets = new Set<Element>()
      disconnected = false
      constructor(readonly callback: ResizeObserverCallback) {
        observers.push(this)
      }
      observe(target: Element) {
        this.targets.add(target)
      }
      unobserve(target: Element) {
        this.targets.delete(target)
      }
      disconnect() {
        this.disconnected = true
        this.targets.clear()
      }
    },
  )
  const layout = document.createElement('div')
  layout.className = 'app-layout desktop-window'
  const main = document.createElement('main')
  main.className = 'main-content'
  const host = document.createElement('div')
  const page = document.createElement('div')
  page.className = 'app-page'
  const frame = measuredElement('desktop-titlebar', 0, 36)
  const topbar = measuredElement('topbar', 36, 96)
  const heading = measuredElement('app-page-header', 120, 186)
  const action = document.createElement('button')
  action.textContent = '收集材料'
  heading.element.append(action)
  page.append(heading.element)
  main.append(topbar.element, host, page)
  layout.append(frame.element, main)
  document.body.append(layout)
  const pinia = createPinia()
  const notifications = useNotifications(pinia)
  const app = createApp(NotificationCenter).use(pinia)
  app.mount(host)
  if (notifyImmediately) notifications.notify('卡组已保存')
  let alive = true
  function stop() {
    if (!alive) return
    alive = false
    app.unmount()
    notifications.clearNotifications()
  }
  cleanups.push(() => {
    stop()
    notifications.clearNotifications()
    layout.remove()
  })
  return {
    layout,
    main,
    page,
    frame,
    topbar,
    heading,
    action,
    notifications,
    observers,
    stop,
    top: () =>
      Number.parseFloat(host.querySelector<HTMLElement>('.notification-center')!.style.top),
    resize(target: Element) {
      observers
        .filter((observer) => !observer.disconnected && observer.targets.has(target))
        .forEach((observer) => observer.callback([], observer as unknown as ResizeObserver))
    },
  }
}

it('keeps notifications below visible page actions as the heading resizes and is replaced', async () => {
  const view = positionedCenter()
  await settle()
  expect(view.top()).toBe(198)
  view.heading.move(120, 230)
  view.resize(view.heading.element)
  await settle()
  expect(view.top()).toBe(242)

  const nextHeading = measuredElement('app-page-header', 120, 164)
  view.page.replaceChildren(nextHeading.element)
  await settle()
  expect(view.top()).toBe(176)
  expect(
    view.observers.some(
      (observer) => !observer.disconnected && observer.targets.has(view.heading.element),
    ),
  ).toBe(false)
  nextHeading.move(120, 208)
  view.resize(nextHeading.element)
  await settle()
  expect(view.top()).toBe(220)

  view.page.replaceChildren()
  await settle()
  expect(view.top()).toBe(108)
  view.topbar.element.remove()
  view.frame.element.remove()
  await settle()
  expect(view.top()).toBe(16)
})

it('does not move a toast over partly visible actions between pointer down and pointer up', async () => {
  const view = positionedCenter()
  await settle()
  view.topbar.move(-48, 12)
  view.heading.move(20, 102)
  view.action.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
  view.main.dispatchEvent(new Event('scroll'))
  await settle()
  // The title starts above the desktop frame, but its action at y=58 is still
  // visible. The toast must stay below the whole header until pointer up.
  expect(view.top()).toBe(114)
  view.action.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
  expect(view.top()).toBeGreaterThan(80)

  view.heading.move(-46, 36)
  view.main.dispatchEvent(new Event('scroll'))
  await settle()
  expect(view.top()).toBe(52)
  view.heading.move(window.innerHeight + 10, window.innerHeight + 92)
  view.main.dispatchEvent(new Event('scroll'))
  await settle()
  expect(view.top()).toBe(52)
  view.topbar.move(36, 96)
  window.dispatchEvent(new Event('resize'))
  await settle()
  expect(view.top()).toBe(108)
})

it('skips boundary queries without notifications and releases observers and listeners on unmount', async () => {
  const view = positionedCenter(false)
  const queries = vi.spyOn(view.layout, 'querySelectorAll')
  await settle()
  view.page.append(document.createElement('p'))
  await settle()
  expect(queries).not.toHaveBeenCalled()
  view.notifications.notify('卡组已保存')
  await settle()
  expect(view.top()).toBe(198)
  expect(queries).toHaveBeenCalled()

  view.stop()
  await settle()
  expect(view.observers.every((observer) => observer.disconnected)).toBe(true)
  queries.mockClear()
  view.heading.measure.mockClear()
  view.notifications.notify('After disposal')
  view.page.append(document.createElement('p'))
  view.main.dispatchEvent(new Event('scroll'))
  window.dispatchEvent(new Event('resize'))
  await settle()
  expect(queries).not.toHaveBeenCalled()
  expect(view.heading.measure).not.toHaveBeenCalled()
})

it('expires only info, pauses its timer on hover, and keeps warnings/errors dismissible when popups are disabled', async () => {
  const pinia = createPinia()
  const { notify, clearNotifications, dismissNotificationContext } = useNotifications(pinia)
  vi.useFakeTimers()
  localStorage.clear()
  restorePreferences()
  clearNotifications()
  setLocale('en')
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp(NotificationCenter).use(pinia)
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
    await vi.advanceTimersByTimeAsync(200)
    expect(host.querySelector('[role=status]')).toBeNull()
    expect(host.querySelectorAll('[role=alert]')).toHaveLength(2)
    setPreference('popupWarning', false)
    await nextTick()
    await vi.advanceTimersByTimeAsync(200)
    expect(host.querySelector('.inline-notifications')!.textContent).toContain('Warning')
    expect(host.querySelector('.notification-center')!.textContent).not.toContain('Warning')
    dismissNotificationContext('review-1')
    await nextTick()
    host.querySelector<HTMLButtonElement>('[role=alert] button')!.click()
    await nextTick()
    await vi.advanceTimersByTimeAsync(200)
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
