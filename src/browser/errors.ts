import { LocalizedError, msg } from '../i18n'

export const workspaceReadMessages = {
  missing: '请选择完整的 Repeaty 工作目录，包括隐藏的 .repeaty 文件夹。',
  incompatible: '这个工作目录的格式暂不受支持，请使用当前桌面版创建的目录。',
  incomplete: '工作目录还有未完成的保存。请在桌面版中关闭学习库，再重新选择目录。',
  changed: '读取期间文件发生变化。请关闭桌面学习库，再重新选择目录。',
  invalid: '工作目录中的数据损坏或不完整，未替换当前学习库。',
  limit: '工作目录超过浏览器读取上限，请使用桌面版打开。',
  permission: '无法读取所选目录，请检查文件访问权限后重试。',
  unavailable: '无法启动工作目录读取器，请重新加载页面后重试。',
  closed: '试用副本已关闭，请重新选择工作目录。',
} as const
export type WorkspaceReadCode = keyof typeof workspaceReadMessages
export class WorkspaceReadError extends LocalizedError {
  constructor(readonly code: WorkspaceReadCode) {
    super(msg(workspaceReadMessages[code]))
  }
}
export function workspaceReadCode(error: unknown): WorkspaceReadCode {
  if (error instanceof WorkspaceReadError) return error.code
  if (error instanceof DOMException) {
    if (error.name === 'NotReadableError') return 'changed'
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError') return 'permission'
  }
  return 'invalid'
}
