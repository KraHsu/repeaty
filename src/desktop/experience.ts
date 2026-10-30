import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { connectWindowCloseGuard } from './window-close-guard'

export interface DesktopConfiguration {
  startHidden: boolean
  closeToTray: boolean
}
export interface DesktopExperienceStatus {
  configuration: DesktopConfiguration
  autostart: boolean | null
  autostartSupported: boolean
  trayAvailable: boolean
  version: string
  platform: string
  architecture: string
  signedUpdates: boolean
  configurationError: boolean
}
export interface DesktopRelease {
  version: string
  currentVersion: string
  newer: boolean
  pageUrl: string
  notes: string
  signed: boolean
  downloaded: boolean
}
export const experienceStatus = () => invoke<DesktopExperienceStatus>('desktop_experience_status')
export const configureExperience = (configuration: DesktopConfiguration) =>
  invoke<DesktopExperienceStatus>('desktop_experience_configure', { configuration })
export const setAutostart = (enabled: boolean) =>
  invoke<DesktopExperienceStatus>('desktop_autostart', { enabled })
export const checkUpdate = () => invoke<DesktopRelease | null>('desktop_update_check')
export const downloadUpdate = () => invoke<void>('desktop_update_download')
export const cancelUpdate = () => invoke<void>('desktop_update_cancel')
export const diagnosticReport = () => invoke<Record<string, unknown>>('desktop_diagnostics')

let activeOwner: symbol | undefined
let installRequest: { owner: symbol; resolve(): void; reject(error: Error): void } | undefined
let installing = false

/** Uses exactly the same pending-editor/save guard as the window's close control. */
export function requestUpdateInstall(): Promise<void> {
  if (!activeOwner) return Promise.reject(new Error('desktop-update-unavailable'))
  if (installRequest || installing) return Promise.reject(new Error('desktop-update-busy'))
  return new Promise<void>((resolve, reject) => {
    const request = { owner: activeOwner!, resolve, reject }
    installRequest = request
    void getCurrentWindow()
      .close()
      .catch(() => {
        if (installRequest !== request) return
        installRequest = undefined
        request.reject(new Error('desktop-update-install-failed'))
      })
  })
}
export async function connectDesktopCloseGuard(beforeClose: () => boolean | Promise<boolean>) {
  const owner = Symbol('desktop-close')
  installRequest?.reject(new Error('desktop-update-save-canceled'))
  installRequest = undefined
  activeOwner = owner
  const canceled = async () => {
    if (activeOwner !== owner) return
    const request = installRequest
    installRequest = undefined
    request?.reject(new Error('desktop-update-save-canceled'))
    await invoke('desktop_cancel_quit')
  }
  const stop = await connectWindowCloseGuard(beforeClose, {
    async afterSave() {
      if (activeOwner !== owner) return 'handled'
      const request = installRequest
      if (!request) return invoke<'close' | 'handled'>('desktop_close_action')
      installRequest = undefined
      installing = true
      try {
        await invoke('desktop_update_install')
        request.resolve()
      } catch {
        request.reject(new Error('desktop-update-install-failed'))
      } finally {
        installing = false
      }
      return 'handled'
    },
    canceled,
  })
  return () => {
    stop()
    if (activeOwner === owner) {
      void canceled().catch(() => {})
      activeOwner = undefined
    }
  }
}

export function desktopError(error: unknown): string {
  const code = error instanceof Error ? error.message : String(error)
  return (
    (
      {
        'desktop-settings-unavailable': '桌面设置未能保存，请重试。',
        'desktop-tray-unavailable': '系统托盘不可用，窗口将继续正常显示和关闭。',
        'desktop-startup-unavailable': '请在安装后的桌面版中设置登录启动。',
        'desktop-startup-failed': '登录启动设置失败，请检查系统权限后重试。',
        'desktop-update-network': '无法检查更新，请检查网络后重试。',
        'desktop-update-invalid': '更新信息无效，当前版本保持不变。',
        'desktop-update-channel-unavailable': '签名更新渠道尚未发布，请从官方发布页下载。',
        'desktop-update-unavailable': '当前构建无法使用签名更新，请从官方发布页下载。',
        'desktop-update-busy': '更新任务正在进行，请稍后重试。',
        'desktop-update-check-required': '请先检查更新。',
        'desktop-update-download-required': '请先下载并验证更新。',
        'desktop-update-verification-failed': '更新下载或签名校验失败，当前版本保持不变。',
        'desktop-update-size-limit': '更新包超过大小上限，已停止下载。',
        'desktop-update-canceled': '更新下载已取消，当前版本保持不变。',
        'desktop-update-save-canceled': '未完成保存，已取消安装更新。',
        'desktop-update-install-failed': '更新未能安装，当前窗口与学习库保持打开。',
        'clipboard-unavailable': '无法复制诊断信息，可以改为导出文件。',
      } as Record<string, string>
    )[code] ?? '桌面操作未完成，请重试。'
  )
}
