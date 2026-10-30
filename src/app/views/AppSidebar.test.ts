// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { createApp, h, ref } from 'vue'
import AppSidebar from './AppSidebar.vue'

const context = vi.hoisted(() => ({ application: {} as Record<string, unknown> }))
vi.mock('../context', () => ({ useApplication: () => context.application }))
vi.mock('../../edition', () => ({ desktopEdition: true }))
vi.mock('@repeaty-platform', () => ({
  WorkspaceBrowser: undefined,
  workspacePendingCount: 0,
  workspaceDetectionError: '',
}))
vi.mock('@nuxt/ui/components/Button.vue', async () => {
  const { defineComponent, h } = await import('vue')
  return {
    default: defineComponent({
      props: ['color', 'variant', 'square', 'loading'],
      setup:
        (_, { attrs, slots }) =>
        () =>
          h('button', attrs, slots.default?.()),
    }),
  }
})
const cleanups: (() => void)[] = []
afterEach(() => {
  cleanups.splice(0).forEach((stop) => stop())
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('realigns the active background when a viewport change only moves links and releases its listeners', () => {
  let resized!: ResizeObserverCallback
  let nextFrame!: FrameRequestCallback
  const cancelFrame = vi.fn()
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn((callback: FrameRequestCallback) => {
      nextFrame = callback
      return 17
    }),
  )
  vi.stubGlobal('cancelAnimationFrame', cancelFrame)
  const disconnect = vi.fn()
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: ResizeObserverCallback) {
        resized = callback
      }
      observe = vi.fn()
      unobserve = vi.fn()
      disconnect = disconnect
    },
  )
  const entry = {
    key: 'statistics',
    pluginId: 'study-statistics',
    contribution: { id: 'statistics', title: '学习统计' },
  }
  context.application = {
    library: ref({ practices: [] }),
    tab: ref('plugin-page'),
    review: ref(),
    mixed: ref(),
    modal: ref(),
    navigate: vi.fn(),
    openHistory: vi.fn(),
    pluginPages: ref([entry]),
    activePluginPage: ref(entry),
    openPluginPage: vi.fn(),
  }
  const added = vi.spyOn(window, 'addEventListener')
  const removed = vi.spyOn(window, 'removeEventListener')
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp({ render: () => h(AppSidebar, { collapsed: true, canToggle: false }) })
  app.mount(host)
  let mounted = true
  const dispose = () => {
    if (!mounted) return
    mounted = false
    app.unmount()
    host.remove()
  }
  cleanups.push(dispose)
  const target = host.querySelector<HTMLElement>('.nav-link[aria-current="page"]')!
  const background = host.querySelector<HTMLElement>('.sidebar-nav-selection')!
  let top = 348
  Object.defineProperties(target, {
    offsetLeft: { get: () => 0 },
    offsetTop: { get: () => top },
    offsetWidth: { get: () => 56 },
    offsetHeight: { get: () => 44 },
  })
  resized([], {} as ResizeObserver)
  expect(background.style.transform).toBe('translate(0px, 348px)')

  // All observed dimensions stay the same: only seven CSS gaps become 4px smaller.
  // Do not emit an observer callback or Vue update; this is the regression trigger.
  window.dispatchEvent(new Event('resize'))
  nextFrame(1)
  top = 320
  nextFrame(2)
  expect(background.style.transform).toBe('translate(0px, 320px)')
  expect(background.style.height).toBe('44px')
  top = 348
  window.dispatchEvent(new Event('resize'))
  nextFrame(3)
  nextFrame(4)
  expect(background.style.transform).toBe('translate(0px, 348px)')

  const listener = added.mock.calls.find(([type]) => type === 'resize')?.[1]
  expect(listener).toBeTypeOf('function')
  window.dispatchEvent(new Event('resize'))
  dispose()
  expect(removed).toHaveBeenCalledWith('resize', listener)
  expect(disconnect).toHaveBeenCalledOnce()
  expect(cancelFrame).toHaveBeenCalledExactlyOnceWith(17)
})
