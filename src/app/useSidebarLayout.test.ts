// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, ref } from 'vue'
import type { SettingsStore } from '../settings-store'
import { SIDEBAR_WIDTH_KEY, useSidebarLayout } from './useSidebarLayout'

const cleanups = new Set<() => void>()
const originalWidth = window.innerWidth

function resizeWindow(width: number) {
  window.innerWidth = width
  window.dispatchEvent(new Event('resize'))
}

function mountLayout(
  options: { desktop?: boolean; ready?: boolean; settings?: SettingsStore } = {},
) {
  const scope = ref(0)
  const ready = ref(options.ready ?? true)
  const settings = options.settings ?? { getItem: vi.fn(() => null), setItem: vi.fn() }
  let layout!: ReturnType<typeof useSidebarLayout>
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp({
    setup() {
      layout = useSidebarLayout({ desktop: options.desktop ?? true, scope, ready, settings })
      return () => h('div', { tabindex: 0 })
    },
  })
  app.mount(host)
  const element = host.firstElementChild as HTMLElement
  const capture = vi.fn()
  const release = vi.fn()
  element.setPointerCapture = capture
  element.releasePointerCapture = release
  function pointer(clientX: number, overrides: Partial<PointerEvent> = {}) {
    return {
      clientX,
      button: 0,
      pointerId: 7,
      isPrimary: true,
      currentTarget: element,
      preventDefault: vi.fn(),
      ...overrides,
    } as unknown as PointerEvent
  }
  function unmount() {
    app.unmount()
    host.remove()
    cleanups.delete(unmount)
  }
  cleanups.add(unmount)
  return { layout, scope, ready, settings, pointer, capture, release, unmount }
}

afterEach(() => {
  for (const cleanup of cleanups) cleanup()
  resizeWindow(originalWidth)
})

it('captures the primary pointer, resizes continuously, and saves only the completed gesture', () => {
  resizeWindow(1200)
  const { layout, settings, pointer, capture, release } = mountLayout()
  layout.startResize(pointer(230, { button: 2 }))
  expect(capture).not.toHaveBeenCalled()
  layout.startResize(pointer(230))
  expect(capture).toHaveBeenCalledWith(7)
  layout.moveResize(pointer(150, { pointerId: 8 }))
  expect(layout.width.value).toBe(230)
  layout.moveResize(pointer(120))
  expect(layout.width.value).toBe(120)
  expect(layout.collapsed.value).toBe(true)
  expect(settings.setItem).not.toHaveBeenCalled()
  layout.moveResize(pointer(700))
  expect(layout.width.value).toBe(360)
  layout.endResize(pointer(700))
  expect(release).toHaveBeenCalledWith(7)
  expect(layout.resizing.value).toBe(false)
  expect(settings.setItem).toHaveBeenCalledExactlyOnceWith(SIDEBAR_WIDTH_KEY, '360')
})

it('rolls back canceled gestures and releases a captured pointer on unmount', () => {
  resizeWindow(1200)
  const { layout, settings, pointer, release, unmount } = mountLayout()
  layout.startResize(pointer(230))
  layout.moveResize(pointer(100))
  layout.cancelResize(pointer(100))
  expect(layout.width.value).toBe(230)
  expect(settings.setItem).not.toHaveBeenCalled()
  layout.startResize(pointer(230))
  layout.moveResize(pointer(180))
  unmount()
  expect(layout.resizing.value).toBe(false)
  expect(release).toHaveBeenCalledTimes(2)
  expect(settings.setItem).not.toHaveBeenCalled()
})

it('restores after settings hydration and isolates late pointers from a new workspace', () => {
  resizeWindow(1200)
  let saved = '290'
  const settings = { getItem: vi.fn(() => saved), setItem: vi.fn() }
  const { layout, ready, scope, pointer } = mountLayout({ ready: false, settings })
  expect(layout.width.value).toBe(230)
  expect(settings.getItem).not.toHaveBeenCalled()
  ready.value = true
  expect(layout.width.value).toBe(290)
  layout.startResize(pointer(290))
  layout.moveResize(pointer(100))
  saved = '210'
  scope.value++
  expect(layout.width.value).toBe(210)
  expect(layout.resizing.value).toBe(false)
  layout.endResize(pointer(100))
  expect(settings.setItem).not.toHaveBeenCalled()
})

it('clamps the visible sidebar in a narrow desktop window without losing the chosen width', async () => {
  resizeWindow(1200)
  const settings = { getItem: vi.fn(() => '320'), setItem: vi.fn() }
  const { layout } = mountLayout({ settings })
  resizeWindow(500)
  await nextTick()
  expect(layout.vertical.value).toBe(true)
  expect(layout.width.value).toBe(100)
  expect(layout.collapsed.value).toBe(true)
  resizeWindow(1200)
  await nextTick()
  expect(layout.width.value).toBe(320)
  expect(layout.collapsed.value).toBe(false)
  expect(settings.setItem).not.toHaveBeenCalled()
})

it('keeps mobile browser navigation horizontal and cancels a gesture when switching layout', async () => {
  resizeWindow(1200)
  const { layout, settings, pointer } = mountLayout({ desktop: false })
  layout.startResize(pointer(230))
  layout.moveResize(pointer(180))
  resizeWindow(720)
  await nextTick()
  expect(layout.vertical.value).toBe(false)
  expect(layout.collapsed.value).toBe(false)
  expect(layout.resizing.value).toBe(false)
  layout.startResize(pointer(230))
  expect(layout.resizing.value).toBe(false)
  resizeWindow(1200)
  await nextTick()
  expect(layout.width.value).toBe(230)
  expect(settings.setItem).not.toHaveBeenCalled()
})

it('provides keyboard bounds and reset while leaving other application instances independent', () => {
  resizeWindow(1200)
  const first = mountLayout()
  const second = mountLayout()
  first.layout.resizeWithKeyboard(new KeyboardEvent('keydown', { key: 'Home' }))
  expect(first.layout.width.value).toBe(72)
  expect(first.layout.collapsed.value).toBe(true)
  first.layout.resizeWithKeyboard(new KeyboardEvent('keydown', { key: 'ArrowRight' }))
  expect(first.layout.width.value).toBe(80)
  first.layout.resizeWithKeyboard(new KeyboardEvent('keydown', { key: 'End' }))
  expect(first.layout.width.value).toBe(360)
  first.layout.resetWidth()
  expect(first.layout.width.value).toBe(230)
  expect(first.settings.setItem).toHaveBeenCalledTimes(4)
  expect(second.layout.width.value).toBe(230)
  expect(second.settings.setItem).not.toHaveBeenCalled()
})

it('falls back on malformed or unavailable storage and keeps resizing when saving fails', async () => {
  resizeWindow(1200)
  const settings = { getItem: vi.fn(() => 'invalid'), setItem: vi.fn() }
  const first = mountLayout({ settings })
  expect(first.layout.width.value).toBe(230)
  settings.getItem.mockImplementation(() => {
    throw new Error('unavailable')
  })
  settings.setItem.mockImplementation(() => {
    throw new Error('unavailable')
  })
  first.scope.value++
  first.layout.resizeWithKeyboard(new KeyboardEvent('keydown', { key: 'Home' }))
  expect(first.layout.width.value).toBe(72)
  const rejected = mountLayout({
    settings: { getItem: () => null, setItem: () => Promise.reject(new Error('unavailable')) },
  })
  rejected.layout.resizeWithKeyboard(new KeyboardEvent('keydown', { key: 'End' }))
  await Promise.resolve()
  expect(rejected.layout.width.value).toBe(360)
})
