import { invoke } from '@tauri-apps/api/core'
import { shallowRef, ref } from 'vue'
import { z } from 'zod'
import { LocalizedError, msg, initI18n, type MessageKey } from '../i18n'
import { useSettingsStore } from '../settings-store'
export type NativeApi = <T>(command: string, args?: Record<string, unknown>) => Promise<T>
export const statusSchema = z.object({
  epoch: z.uuid(),
  active: z.object({ id: z.uuid(), token: z.uuid(), path: z.string() }).nullable(),
  recent: z.array(z.object({ id: z.uuid(), path: z.string() })),
  error: z.string().nullable(),
})
export type WorkspaceStatus = z.infer<typeof statusSchema>
export type ActiveWorkspace = NonNullable<WorkspaceStatus['active']>
export const workspaceStatus = shallowRef<WorkspaceStatus>()
export const workspaceAvailable = ref(false)
export const workspaceLoading = ref(true)
export const workspaceAttention = shallowRef<{ path: string; status: string }[]>([])
let boot: Promise<void> | undefined
let pending: Promise<unknown> = Promise.resolve()
let frozen = false
const settings = new Map<string, string>()
export function installWorkspaceStores() {
  // Never read browser storage, including while native startup is still pending.
  useSettingsStore({
    getItem: (key) => settings.get(key) ?? null,
    setItem: async (key, value) => {
      const active = await currentWorkspace()
      await workspaceApi('workspace_write', {
        token: active.token,
        request: { type: 'value', namespace: 'settings', id: key, value },
      })
      settings.set(key, value)
    },
  })
}
async function hydrateSettings() {
  const active = workspaceStatus.value?.active
  settings.clear()
  if (active) {
    const values = await workspaceApi<Record<string, unknown>>('workspace_read', {
      token: active.token,
      request: { type: 'settings' },
    })
    for (const [key, value] of Object.entries(values))
      if (typeof value === 'string') settings.set(key, value)
  }
  initI18n()
}
export function nativeError(issue: unknown) {
  const code = typeof issue === 'string' ? issue : issue instanceof Error ? issue.message : ''
  const messages: Record<string, MessageKey> = {
    'workspace-not-open': '请先创建或打开工作目录。',
    'workspace-not-empty': '请选择空文件夹。已有文件不会被覆盖。',
    'workspace-incompatible': '不支持这个工作目录格式。',
    'workspace-already-open': '这个学习库已在另一窗口中打开。',
    'workspace-missing': '找不到工作目录或必要文件。',
    'workspace-identity-changed': '工作目录已被移动或替换，请重新打开。',
    'stale-workspace-session': '学习库已切换，请重新打开当前内容。',
    'working-file-changed': '文件已在外部修改，请先在工作目录页面检查并接受修改。',
    'revision-conflict': '学习库内容已变化，请重新载入。',
    'permission-denied': '无法访问工作目录，请检查文件夹权限。',
    'unsafe-file': '目录中包含链接或不支持的文件，操作已停止。',
    'workspace-limit': '本次文件检查超过范围，请减少文件数量或大小。',
    'invalid-data': '内容无效，修改未保存。',
    'not-found': '内容已不存在，请重新载入。',
    'storage-error': '无法读写工作目录，请检查磁盘空间和文件权限。',
  }
  return new LocalizedError(msg(messages[code] ?? '无法读写工作目录，请检查磁盘空间和文件权限。'))
}
export async function loadWorkspaceStatus() {
  workspaceStatus.value = statusSchema.parse(await invoke('workspace_status'))
  workspaceAvailable.value = Boolean(workspaceStatus.value.active)
  return workspaceStatus.value
}
export function initializeWorkspaces() {
  return (boot ??= loadWorkspaceStatus()
    .then(hydrateSettings)
    .finally(() => {
      workspaceLoading.value = false
    }))
}
export async function currentWorkspace() {
  await initializeWorkspaces()
  const active = workspaceStatus.value?.active
  if (!active) throw nativeError('workspace-not-open')
  return active
}
export const workspaceApi: NativeApi = async <T>(
  command: string,
  args?: Record<string, unknown>,
) => {
  if (frozen) throw nativeError('stale-workspace-session')
  const execute = async () => {
    try {
      return await invoke<T>(command, args)
    } catch (issue) {
      throw nativeError(issue)
    }
  }
  if (command === 'workspace_write') {
    const result = pending.then(execute)
    pending = result.catch(() => {})
    return result
  }
  await pending
  return execute()
}
export async function changeWorkspace(action: () => Promise<unknown>) {
  frozen = true
  try {
    await pending
    const result = await action()
    if (result === null) {
      frozen = false
      return
    }
    window.location.reload()
  } catch (issue) {
    frozen = false
    throw nativeError(issue)
  }
}
export const chooseWorkspace = (mode: 'create' | 'open') =>
  changeWorkspace(() => invoke('workspace_choose', { epoch: workspaceStatus.value?.epoch, mode }))
export const closeWorkspace = () =>
  changeWorkspace(() => invoke('workspace_close', { epoch: workspaceStatus.value?.epoch }))
export const recentWorkspace = (path: string, id: string) =>
  changeWorkspace(() =>
    invoke('workspace_recent', { epoch: workspaceStatus.value?.epoch, path, id }),
  )
export const restoreWorkspace = () =>
  changeWorkspace(() => invoke('workspace_restore', { epoch: workspaceStatus.value?.epoch }))
