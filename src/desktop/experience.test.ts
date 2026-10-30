import { afterEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ invoke: vi.fn(), close: vi.fn(), connect: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }))
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ close: mocks.close }) }))
vi.mock('./window-close-guard', () => ({ connectWindowCloseGuard: mocks.connect }))
import {
  connectDesktopCloseGuard,
  desktopError,
  requestUpdateInstall,
  configureExperience,
  setAutostart,
} from './experience'

afterEach(() => vi.resetAllMocks())
it('keeps OS startup separate from device preferences and does not send paths', async () => {
  await configureExperience({ startHidden: true, closeToTray: false })
  await setAutostart(true)
  expect(mocks.invoke.mock.calls).toEqual([
    ['desktop_experience_configure', { configuration: { startHidden: true, closeToTray: false } }],
    ['desktop_autostart', { enabled: true }],
  ])
})
it('only installs after the existing save guard allows it, and blocks duplicate installs', async () => {
  let hooks!: { afterSave(): Promise<string>; canceled(): Promise<void> }
  const guard = vi.fn(async () => true)
  mocks.connect.mockImplementation(async (before, options) => {
    expect(before).toBe(guard)
    hooks = options
    return () => {}
  })
  mocks.close.mockResolvedValue(undefined)
  let finish!: () => void
  mocks.invoke.mockImplementation((command: string) =>
    command === 'desktop_update_install'
      ? new Promise<void>((done) => {
          finish = done
        })
      : Promise.resolve('handled'),
  )
  const stop = await connectDesktopCloseGuard(guard)
  const request = requestUpdateInstall()
  expect(mocks.invoke).not.toHaveBeenCalled()
  await expect(requestUpdateInstall()).rejects.toThrow('desktop-update-busy')
  const action = hooks.afterSave()
  await expect(requestUpdateInstall()).rejects.toThrow('desktop-update-busy')
  finish()
  await request
  expect(await action).toBe('handled')
  expect(mocks.invoke).toHaveBeenCalledWith('desktop_update_install')
  stop()
})
it('canceling a save cancels installation and resets the tray quit intent', async () => {
  let hooks!: { canceled(): Promise<void> }
  mocks.connect.mockImplementation(async (_before, options) => {
    hooks = options
    return () => {}
  })
  mocks.close.mockResolvedValue(undefined)
  mocks.invoke.mockResolvedValue(undefined)
  const stop = await connectDesktopCloseGuard(async () => false)
  const result = requestUpdateInstall().catch((error: Error) => error.message)
  await hooks.canceled()
  expect(await result).toBe('desktop-update-save-canceled')
  expect(mocks.invoke).toHaveBeenCalledWith('desktop_cancel_quit')
  expect(mocks.invoke).not.toHaveBeenCalledWith('desktop_update_install')
  stop()
})
it('failed installation keeps the window handled and allows a later retry', async () => {
  let hooks!: { afterSave(): Promise<string> }
  mocks.connect.mockImplementation(async (_before, options) => {
    hooks = options
    return () => {}
  })
  mocks.close.mockResolvedValue(undefined)
  mocks.invoke.mockRejectedValueOnce(new Error('native install failed'))
  const stop = await connectDesktopCloseGuard(async () => true)
  const result = requestUpdateInstall().catch((error: Error) => error.message)
  expect(await hooks.afterSave()).toBe('handled')
  expect(await result).toBe('desktop-update-install-failed')
  mocks.invoke.mockResolvedValue('handled')
  const retry = requestUpdateInstall()
  await hooks.afterSave()
  await retry
  stop()
})
it('never exposes raw native errors or private paths in UI error messages', () => {
  expect(desktopError(new Error('D:\\private\\token.txt'))).toBe('桌面操作未完成，请重试。')
  expect(desktopError('desktop-update-verification-failed')).toContain('签名校验失败')
})
