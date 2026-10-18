import type { Request } from './connector/protocol'

const errors: Record<string, string> = {
  'extension-unavailable': '未连接扩展。请安装扩展后刷新 Repeaty。',
  'open-leetcode': '请在另一个标签页打开所选 LeetCode 站点并登录，然后重试。',
  'login-required': '请在 LeetCode 标签页登录或完成验证，然后重试。',
  'rate-limit': '提交过于频繁，请稍后重试。',
  'submission-busy': '上一次提交尚未完成，请稍候。',
  'submission-unknown': '未取得提交编号，请先在 LeetCode 检查提交记录，避免重复提交。',
  'request-failed': '无法连接 LeetCode，请检查网络及 LeetCode 标签页后重试。',
}
export function bridgeRequest(request: Request, signal?: AbortSignal): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID()
    const cleanup = () => {
      clearTimeout(timer)
      window.removeEventListener('message', receive)
      signal?.removeEventListener('abort', abort)
    }
    const abort = () => {
      cleanup()
      reject(new DOMException('Aborted', 'AbortError'))
    }
    const receive = (event: MessageEvent) => {
      if (
        event.source !== window ||
        event.origin !== location.origin ||
        event.data?.channel !== 'repeaty-leetcode-response' ||
        event.data.id !== id
      )
        return
      cleanup()
      const response = event.data.response
      if (response?.ok === true) resolve(response.data)
      else reject(new Error(errors[response?.error] ?? errors['request-failed']))
    }
    const timer = setTimeout(
      () => {
        cleanup()
        reject(
          new Error(
            errors[
              request.action === 'ping'
                ? 'extension-unavailable'
                : request.action === 'submit'
                  ? 'submission-unknown'
                  : 'request-failed'
            ],
          ),
        )
      },
      request.action === 'ping' ? 1500 : 25000,
    )
    if (signal?.aborted) {
      abort()
      return
    }
    window.addEventListener('message', receive)
    signal?.addEventListener('abort', abort, { once: true })
    window.postMessage({ channel: 'repeaty-leetcode-request', id, request }, location.origin)
  })
}
