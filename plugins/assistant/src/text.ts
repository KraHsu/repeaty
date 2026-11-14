import { locale } from '@repeaty/plugin-api'
export const t = (zh: string, en: string) => (!locale.value.startsWith('zh') ? en : zh)
export function errorText(code?: string) {
  switch (code) {
    case 'interrupted':
      return t(
        '已停止。草稿和已收到的回复已保留。',
        'Stopped. Your draft and the partial reply are kept.',
      )
    case 'storage':
      return t(
        '保存失败。请保留当前页面，检查工作目录空间后重试。',
        'Could not save. Keep this page open and check available storage before retrying.',
      )
    case 'authentication':
      return t(
        '连接凭据失效，请在设置中重新连接。',
        'Authentication failed. Reconnect in Settings.',
      )
    case 'scope':
      return t(
        '此操作超出当前授权范围。请检查范围后重新发起。',
        'This operation is outside the authorized scope. Check the scope and try again.',
      )
    case 'stale':
      return t(
        '学习内容已更新。请重新读取内容并生成建议，原建议没有覆盖新数据。',
        'The library has changed. Read the current content and prepare a new proposal; newer data was not overwritten.',
      )
    case 'protocol':
      return t(
        '提供方返回的工具或流式格式不完整。回复和草稿已保留。',
        'The provider returned an incomplete stream or tool call. Your reply and draft are kept.',
      )
    case 'tool-limit':
      return t(
        '本轮已达到工具调用上限，已保留当前结果。',
        'The tool-call limit was reached. Current results are kept.',
      )
    case 'network':
      return t(
        '连接超时或中断，草稿已保留。',
        'Connection timed out or was interrupted. Your draft is kept.',
      )
    case 'model':
      return t(
        '模型未完成请求。请检查模型、权限或服务状态后重试。',
        'The model could not finish. Check the model, access and service status before retrying.',
      )
    default:
      return t(
        '暂时无法完成。请检查桌面连接、提供方设置与授权范围。',
        'Could not complete this action. Check the desktop connection, provider settings and authorized scope.',
      )
  }
}
