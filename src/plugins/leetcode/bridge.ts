import { localPlugin } from '../../desktop/native'
import type { Request } from './request'
const errors: Record<string, string> = {
  'leetcode-not-configured': '请先在插件页面填写该站点的 LeetCode 登录信息。',
  'login-required': 'LeetCode 登录已过期或需要验证，请更新本机的登录信息。',
  'rate-limit': '提交过于频繁，请稍后重试。',
  'submission-busy': '上一次提交尚未完成，请稍候。',
  'submission-unknown': '未取得提交编号，请先在 LeetCode 检查提交记录，避免重复提交。',
  'request-failed': '无法连接 LeetCode，请稍后重试。',
  'submission-unavailable': '无法读取该提交，请检查编号和当前 LeetCode 登录信息。',
  'submission-not-owned': '该提交不属于当前登录的 LeetCode 账号。',
  'submission-mismatch': '该提交的题目、语言、代码或时间与本次记录不符。',
}
export class BridgeError extends Error {
  constructor(readonly code: string) {
    super(errors[code] ?? errors['request-failed'])
  }
}
export async function bridgeRequest(request: Request, signal?: AbortSignal): Promise<unknown> {
  try {
    signal?.throwIfAborted()
    const result = await localPlugin('leetcode', 'request', request)
    signal?.throwIfAborted()
    return result
  } catch (error) {
    if (signal?.aborted) throw error
    const code = typeof error === 'string' ? error : 'request-failed'
    // A broken connection may have lost the acknowledgement of a real submission.
    throw new BridgeError(
      request.action === 'submit' && code === 'request-failed' ? 'submission-unknown' : code,
    )
  }
}
