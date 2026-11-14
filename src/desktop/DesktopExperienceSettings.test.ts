// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createApp, nextTick } from 'vue'
import DesktopExperienceSettings from './DesktopExperienceSettings.vue'
import * as service from './experience'
import { setLocale } from '../i18n'
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }))
vi.mock('./experience', async () => {
  const original = await vi.importActual<typeof service>('./experience')
  return {
    ...original,
    experienceStatus: vi.fn(),
    configureExperience: vi.fn(),
    setAutostart: vi.fn(),
    checkUpdate: vi.fn(),
    downloadUpdate: vi.fn(),
    cancelUpdate: vi.fn(),
    diagnosticReport: vi.fn(),
    requestUpdateInstall: vi.fn(),
  }
})
let unmount: (() => void) | undefined
const status: service.DesktopExperienceStatus = {
  configuration: { startHidden: false, closeToTray: false },
  autostart: false,
  autostartSupported: true,
  trayAvailable: true,
  version: '0.27.0',
  platform: 'windows',
  architecture: 'x86_64',
  signedUpdates: false,
  configurationError: false,
}
beforeEach(() => {
  vi.resetAllMocks()
  setLocale('zh-CN')
  vi.mocked(service.experienceStatus).mockResolvedValue(status)
})
afterEach(() => {
  unmount?.()
  document.body.innerHTML = ''
})
async function mount() {
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp(DesktopExperienceSettings)
  app.mount(host)
  unmount = () => app.unmount()
  await vi.waitFor(() => expect(host.textContent).toContain('0.27.0'))
  return host
}
function button(host: Element, label: string) {
  return [...host.querySelectorAll('button')].find((item) => item.textContent?.trim() === label)!
}
it('does not claim automatic installation before a signed channel exists', async () => {
  vi.mocked(service.checkUpdate).mockResolvedValue({
    version: '1.0.0',
    currentVersion: '0.27.0',
    newer: true,
    notes: 'Release',
    pageUrl: 'https://github.com/KraHsu/repeaty/releases/tag/v1.0.0',
    signed: false,
    downloaded: false,
  })
  const host = await mount()
  button(host, '检查更新').click()
  await vi.waitFor(() => expect(host.textContent).toContain('发现新版本'))
  expect(host.textContent).toContain('当前构建未配置签名更新渠道')
  expect(host.textContent).not.toContain('保存并安装更新')
  expect(service.downloadUpdate).not.toHaveBeenCalled()
})
it('keeps a previous usable release visible after a failed check', async () => {
  vi.mocked(service.checkUpdate)
    .mockResolvedValueOnce({
      version: '1.0.0',
      currentVersion: '0.27.0',
      newer: true,
      notes: '',
      pageUrl: 'https://github.com/KraHsu/repeaty/releases/tag/v1.0.0',
      signed: false,
      downloaded: false,
    })
    .mockRejectedValueOnce('desktop-update-network')
  const host = await mount()
  button(host, '检查更新').click()
  await vi.waitFor(() => expect(host.textContent).toContain('发现新版本'))
  button(host, '检查更新').click()
  await vi.waitFor(() => expect(host.textContent).toContain('无法检查更新'))
  expect(host.textContent).toContain('1.0.0')
})
it('only offers installation after native download and verification succeeded', async () => {
  vi.mocked(service.experienceStatus).mockResolvedValue({ ...status, signedUpdates: true })
  vi.mocked(service.checkUpdate).mockResolvedValue({
    version: '1.0.0',
    currentVersion: '0.27.0',
    newer: true,
    notes: '',
    pageUrl: 'https://github.com/KraHsu/repeaty/releases',
    signed: true,
    downloaded: false,
  })
  vi.mocked(service.downloadUpdate)
    .mockRejectedValueOnce('desktop-update-verification-failed')
    .mockResolvedValueOnce(undefined)
  const host = await mount()
  button(host, '检查更新').click()
  await vi.waitFor(() => expect(button(host, '下载并验证更新')).toBeDefined())
  button(host, '下载并验证更新').click()
  await vi.waitFor(() => expect(host.textContent).toContain('签名校验失败'))
  expect(button(host, '保存并安装更新')).toBeUndefined()
  button(host, '下载并验证更新').click()
  await vi.waitFor(() => expect(button(host, '保存并安装更新')).toBeDefined())
  button(host, '保存并安装更新').click()
  await nextTick()
  expect(service.requestUpdateInstall).toHaveBeenCalledOnce()
})
it('waits for explicit diagnostic preview and preserves device switches on failed writes', async () => {
  vi.mocked(service.configureExperience).mockRejectedValue('desktop-settings-unavailable')
  vi.mocked(service.diagnosticReport).mockResolvedValue({
    application: 'Repeaty',
    schema: 1,
    platform: 'windows',
  })
  const host = await mount()
  expect(service.diagnosticReport).not.toHaveBeenCalled()
  const close = host.querySelectorAll<HTMLButtonElement>('[role=switch]')[2]!
  close.click()
  await vi.waitFor(() => expect(host.textContent).toContain('未能保存'))
  expect(close.getAttribute('aria-checked')).toBe('false')
  button(host, '预览诊断信息').click()
  await vi.waitFor(() =>
    expect(host.querySelector('textarea')?.value).toContain('"platform": "windows"'),
  )
})
