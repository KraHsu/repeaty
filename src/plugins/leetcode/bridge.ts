import { apiJson, ServerError } from '../../backend/client'
import type { Request } from './request'
const errors: Record<string, string> = {
  'leetcode-not-configured': '服务尚未配置该站点的 LeetCode 登录信息，请联系部署者。',
  'login-required': 'LeetCode 登录已过期或需要验证，请部署者更新连接配置。',
  'rate-limit': '提交过于频繁，请稍后重试。',
  'submission-busy': '上一次提交尚未完成，请稍候。',
  'submission-unknown': '未取得提交编号，请先在 LeetCode 检查提交记录，避免重复提交。',
  'request-failed': '服务无法连接 LeetCode，请稍后重试。',
}
export class BridgeError extends Error {
  constructor(readonly code: string) {
    super(errors[code] ?? errors['request-failed'])
  }
}
export async function bridgeRequest(request: Request, signal?: AbortSignal): Promise<unknown> {
  try {
    return await apiJson('/plugins/leetcode', request, signal)
  } catch (error) {
    if (signal?.aborted) throw error
    if (error instanceof ServerError && ['unauthorized', 'origin-rejected'].includes(error.code))
      throw error
    const code = error instanceof ServerError ? error.code : 'request-failed'
    // A broken connection may have lost the acknowledgement of a real submission.
    throw new BridgeError(
      request.action === 'submit' && code === 'request-failed' ? 'submission-unknown' : code,
    )
  }
}
