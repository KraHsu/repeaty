// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, ref } from 'vue'
import type { SettingsStore } from '../settings-store'
import { SIDEBAR_EXPANDED_WIDTH_KEY, SIDEBAR_WIDTH_KEY, useSidebarLayout } from './useSidebarLayout'

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
  layout.startResize(pointer(80, { button: 2 }))
  expect(capture).not.toHaveBeenCalled()
  layout.startResize(pointer(80))
  expect(capture).toHaveBeenCalledWith(7)
  layout.moveResize(pointer(150, { pointerId: 8 }))
  expect(layout.width.value).toBe(80)
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
  layout.startResize(pointer(80))
  layout.moveResize(pointer(100))
  layout.cancelResize(pointer(100))
  expect(layout.width.value).toBe(80)
  expect(settings.setItem).not.toHaveBeenCalled()
  layout.startResize(pointer(80))
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
  expect(layout.width.value).toBe(80)
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
  expect(layout.canToggle.value).toBe(false)
  layout.toggle()
  expect(layout.width.value).toBe(100)
  expect(settings.setItem).not.toHaveBeenCalled()
  resizeWindow(1200)
  await nextTick()
  expect(layout.width.value).toBe(320)
  expect(layout.collapsed.value).toBe(false)
  expect(settings.setItem).not.toHaveBeenCalled()
})

it('keeps mobile browser navigation horizontal and cancels a gesture when switching layout', async () => {
  resizeWindow(1200)
  const { layout, settings, pointer } = mountLayout({ desktop: false })
  layout.startResize(pointer(80))
  layout.moveResize(pointer(180))
  resizeWindow(720)
  await nextTick()
  expect(layout.vertical.value).toBe(false)
  expect(layout.collapsed.value).toBe(false)
  expect(layout.resizing.value).toBe(false)
  expect(layout.canToggle.value).toBe(false)
  layout.toggle()
  layout.startResize(pointer(80))
  expect(layout.resizing.value).toBe(false)
  resizeWindow(1200)
  await nextTick()
  expect(layout.width.value).toBe(80)
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
  expect(first.layout.width.value).toBe(80)
  expect(first.settings.setItem).toHaveBeenCalledTimes(4)
  expect(second.layout.width.value).toBe(80)
  expect(second.settings.setItem).not.toHaveBeenCalled()
})

it('falls back on malformed or unavailable storage and keeps resizing when saving fails', async () => {
  resizeWindow(1200)
  const settings = { getItem: vi.fn(() => 'invalid'), setItem: vi.fn() }
  const first = mountLayout({ settings })
  expect(first.layout.width.value).toBe(80)
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

it('starts as an icon rail and expands to the default reading width', () => {
  resizeWindow(1200)
  const { layout, settings } = mountLayout()
  expect(layout.width.value).toBe(80)
  expect(layout.collapsed.value).toBe(true)
  expect(layout.canToggle.value).toBe(true)
  layout.toggle()
  expect(layout.width.value).toBe(208)
  expect(layout.collapsed.value).toBe(false)
  expect(settings.setItem).toHaveBeenCalledExactlyOnceWith(SIDEBAR_WIDTH_KEY, '208')
  layout.toggle()
  expect(layout.width.value).toBe(80)
  expect(settings.setItem).toHaveBeenCalledWith(SIDEBAR_EXPANDED_WIDTH_KEY, '208')
  expect(settings.setItem).toHaveBeenLastCalledWith(SIDEBAR_WIDTH_KEY, '80')
})

it('remembers a resized expanded width across collapse and application reload', () => {
  resizeWindow(1200)
  const values = new Map<string, string>()
  const settings = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value)
    }),
  }
  const first = mountLayout({ settings })
  first.layout.startResize(first.pointer(80))
  first.layout.moveResize(first.pointer(288))
  first.layout.endResize(first.pointer(288))
  first.layout.toggle()
  expect(values.get(SIDEBAR_WIDTH_KEY)).toBe('80')
  expect(values.get(SIDEBAR_EXPANDED_WIDTH_KEY)).toBe('288')
  first.unmount()

  const reloaded = mountLayout({ settings })
  expect(reloaded.layout.width.value).toBe(80)
  reloaded.layout.toggle()
  expect(reloaded.layout.width.value).toBe(288)
  expect(settings.setItem).toHaveBeenLastCalledWith(SIDEBAR_WIDTH_KEY, '288')
})

it('keeps the remembered expanded width when expanding under a temporary viewport cap', async () => {
  resizeWindow(1200)
  const values = new Map([
    [SIDEBAR_WIDTH_KEY, '80'],
    [SIDEBAR_EXPANDED_WIDTH_KEY, '288'],
  ])
  const settings = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value)
    }),
  }
  const { layout } = mountLayout({ settings })
  resizeWindow(600)
  await nextTick()
  expect(layout.canToggle.value).toBe(true)
  layout.toggle()
  expect(layout.width.value).toBe(200)
  expect(layout.collapsed.value).toBe(false)
  expect(values.get(SIDEBAR_WIDTH_KEY)).toBe('288')
  expect(values.get(SIDEBAR_EXPANDED_WIDTH_KEY)).toBe('288')

  resizeWindow(1200)
  await nextTick()
  expect(layout.width.value).toBe(288)
  expect(settings.setItem).toHaveBeenCalledExactlyOnceWith(SIDEBAR_WIDTH_KEY, '288')
})

it('restores each workspace expanded width without carrying the previous workspace preference', () => {
  resizeWindow(1200)
  const libraries = [
    new Map([
      [SIDEBAR_WIDTH_KEY, '80'],
      [SIDEBAR_EXPANDED_WIDTH_KEY, '288'],
    ]),
    new Map([
      [SIDEBAR_WIDTH_KEY, '80'],
      [SIDEBAR_EXPANDED_WIDTH_KEY, '192'],
    ]),
    new Map<string, string>(),
  ]
  let activeLibrary = 0
  const settings = {
    getItem: (key: string) => libraries[activeLibrary]!.get(key) ?? null,
    setItem: vi.fn((key: string, value: string) => {
      libraries[activeLibrary]!.set(key, value)
    }),
  }
  const { layout, scope } = mountLayout({ settings })
  layout.toggle()
  expect(layout.width.value).toBe(288)
  activeLibrary = 1
  scope.value++
  expect(layout.width.value).toBe(80)
  layout.toggle()
  expect(layout.width.value).toBe(192)
  expect(libraries[0]!.get(SIDEBAR_WIDTH_KEY)).toBe('288')
  activeLibrary = 2
  scope.value++
  layout.toggle()
  expect(layout.width.value).toBe(208)
  expect(libraries[1]!.get(SIDEBAR_WIDTH_KEY)).toBe('192')
})

it('does not persist toggles before the workspace settings are ready', () => {
  resizeWindow(1200)
  const settings = {
    getItem: vi.fn((key: string) => (key === SIDEBAR_EXPANDED_WIDTH_KEY ? '272' : '80')),
    setItem: vi.fn(),
  }
  const { layout, ready } = mountLayout({ ready: false, settings })
  layout.toggle()
  expect(layout.width.value).toBe(208)
  layout.toggle()
  expect(layout.width.value).toBe(80)
  expect(settings.setItem).not.toHaveBeenCalled()
  ready.value = true
  layout.toggle()
  expect(layout.width.value).toBe(272)
  expect(settings.setItem).toHaveBeenCalledExactlyOnceWith(SIDEBAR_WIDTH_KEY, '272')
})
