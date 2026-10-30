// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createApp, nextTick, ref, shallowRef } from 'vue'
import CaptureSettings from './CaptureSettings.vue'
import { captureStatus, configureCapture, type CaptureStatus } from './collection'
import { setLocale } from '../i18n'

const context = vi.hoisted(() => ({ application: undefined as unknown }))
vi.mock('../app/context', () => ({ useApplication: () => context.application }))
vi.mock('./collection', () => ({ captureStatus: vi.fn(), configureCapture: vi.fn() }))
let unmount: (() => void) | undefined
beforeEach(() => {
  setLocale('en')
  vi.resetAllMocks()
  context.application = {
    workspace: { ready: ref(false), scope: ref('') },
    capture: {
      pending: shallowRef(),
      error: ref(''),
      saving: ref(false),
      retry: vi.fn(),
      discard: vi.fn(),
    },
  }
})
afterEach(() => {
  unmount?.()
  document.body.innerHTML = ''
  setLocale('zh-CN')
})
async function mount(status: CaptureStatus) {
  vi.mocked(captureStatus).mockResolvedValue(status)
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp(CaptureSettings)
  app.mount(host)
  unmount = () => app.unmount()
  await Promise.resolve()
  await nextTick()
  return host
}
function status(shortcutAvailable: boolean): CaptureStatus {
  return {
    configuration: { enabled: false, shortcut: 'CommandOrControl+Shift+Space', mode: 'clipboard' },
    registered: false,
    error: null,
    selection: false,
    permission: 'not-required',
    shortcutAvailable,
  }
}
it('disables unavailable shortcuts and explains the platform and library requirements in English', async () => {
  const host = await mount(status(false))
  expect(host.textContent).toContain('Global shortcuts are unavailable on this platform.')
  expect(host.textContent).toContain('Open a library first')
  expect(host.textContent).not.toMatch(/[\u4e00-\u9fff]/)
  const save = [...host.querySelectorAll('button')].find(
    (button) => button.textContent === 'Save shortcut',
  )!
  expect(save.disabled).toBe(true)
  save.click()
  expect(configureCapture).not.toHaveBeenCalled()
  setLocale('zh-CN')
  await nextTick()
  expect(host.textContent).toContain('当前平台不支持全局快捷键')
})
it('renders native shortcut errors as translated guidance', async () => {
  const value = status(true)
  value.error = 'capture-shortcut-unavailable'
  const host = await mount(value)
  expect(host.textContent).toContain('Another app may be using it; choose a different combination.')
  expect(host.textContent).not.toContain('capture-shortcut-unavailable')
})
