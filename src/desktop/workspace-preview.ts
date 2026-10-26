import { invoke } from '@tauri-apps/api/core'
import { ref, shallowRef } from 'vue'
import {
  previewScanSchema,
  previewStatusSchema,
  type PreviewScan,
  type PreviewStatus,
} from '../workspace/preview'
import type { FileChange } from '../workspace/changes'
import { createInspector, type Inspector } from './workspace-inspector'

export type PreviewApi = <T>(command: string, args?: Record<string, unknown>) => Promise<T>
export function createWorkspacePreview(
  api: PreviewApi = invoke,
  inspector: Inspector = createInspector(),
) {
  const status = shallowRef<PreviewStatus>()
  const scan = shallowRef<PreviewScan>()
  const busy = ref(false),
    error = ref('')
  let generation = 0,
    alive = true
  const files = shallowRef<FileChange[]>([])
  async function execute(action: () => Promise<unknown>) {
    if (busy.value || !alive) return
    busy.value = true
    error.value = ''
    const sequence = ++generation
    let reading = false
    try {
      const response = await action()
      if (!alive || sequence !== generation) return
      if (response === null) return
      const next = previewStatusSchema.parse(response)
      if (next.active?.token !== status.value?.active?.token) {
        scan.value = undefined
        files.value = []
      }
      status.value = next
      const token = status.value?.active?.token
      if (token) {
        reading = true
        const result = previewScanSchema.parse(await api('workspace_preview_scan', { token }))
        if (!alive || sequence !== generation || status.value?.active?.token !== token) return
        if (result.token !== token) throw new Error('stale-workspace-session')
        const changes = await inspector.inspect(result)
        if (!alive || sequence !== generation || status.value?.active?.token !== token) return
        scan.value = result
        files.value = changes
      } else {
        scan.value = undefined
        files.value = []
      }
    } catch (cause) {
      if (alive && sequence === generation) {
        if (reading) {
          scan.value = undefined
          files.value = []
        }
        error.value =
          typeof cause === 'string'
            ? cause
            : cause instanceof Error
              ? cause.message
              : 'workspace-unavailable'
      }
    } finally {
      if (alive && sequence === generation) busy.value = false
    }
  }
  return {
    status,
    scan,
    files,
    busy,
    error,
    refresh: () => execute(() => api('workspace_preview_status')),
    retry: () =>
      execute(() =>
        status.value?.restore_error && !status.value.active
          ? api('workspace_preview_restore', { epoch: status.value.epoch })
          : api('workspace_preview_status'),
      ),
    choose: (mode: 'create' | 'open') =>
      execute(() => api('workspace_preview_choose', { epoch: status.value?.epoch, mode })),
    recent: (path: string, id: string) =>
      execute(() => api('workspace_preview_recent', { epoch: status.value?.epoch, path, id })),
    close: () => execute(() => api('workspace_preview_close', { epoch: status.value?.epoch })),
    dispose() {
      alive = false
      generation++
      inspector.dispose()
    },
  }
}

export function workspacePreviewMessage(code: string): string {
  switch (code) {
    case 'prototype-root-must-be-empty':
      return '请选择一个空文件夹。目录中已有的文件不会被覆盖。'
    case 'not-an-m0-prototype':
    case 'incompatible-prototype-database':
      return '暂不支持这个目录格式。请选择由工作目录预览创建的文件夹。'
    case 'prototype-already-open':
    case 'workspace-already-open':
      return '这个工作目录已在使用中。请先关闭另一会话，再重新打开。'
    case 'workspace-identity-changed':
      return '目录已被移动或替换。请通过“打开目录”重新选择。'
    case 'unknown-recent-workspace':
      return '最近记录已变化。请通过“打开目录”重新选择。'
    case 'workspace-missing':
      return '找不到目录或必要文件。请检查位置，再重新打开。'
    case 'stale-workspace-session':
      return '目录会话已变化。请重新扫描或打开目录。'
    case 'permission-denied':
      return '无法访问这个目录。请检查文件夹权限。'
    case 'preview-limit':
      return '文件数量或总大小超出本次预览范围，扫描结果不完整。'
    case 'invalid-utf8':
      return '文件不是有效的 UTF-8 文本。请保留原文件，检查编码后重新扫描。'
    case 'file-too-large':
      return '文件超过 2 MiB，未读取其正文。'
    case 'file-changing':
      return '读取期间文件发生变化。请保存后重新扫描。'
    case 'unsafe-file':
    case 'unsafe-directory':
      return '已跳过链接或不支持的文件。扫描结果不完整。'
    default:
      return '暂时无法读取工作目录。请检查文件和权限后重试。'
  }
}
