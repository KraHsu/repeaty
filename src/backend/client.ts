import { LocalizedError, msg } from '../i18n'

export type ApiTransport = (path: string, init: RequestInit) => Promise<Response>
let transport: ApiTransport = (path, init) =>
  fetch(`/api${path}`, { ...init, credentials: 'same-origin', cache: 'no-store' })
export function setApiTransport(value: ApiTransport) {
  transport = value
}
const messages: Record<string, string> = {
  'incompatible-version': '服务版本不兼容，请同时更新前端和后端。',
  'account-changed': '登录账户已变更，请刷新页面后重试。',
  unauthorized: '请登录；用户名或密码错误时请重新输入。',
  'username-unavailable': '用户名已被使用。',
  'invalid-username': '用户名需为 3–32 位字母、数字、下划线或连字符。',
  'invalid-password': '密码需为 12–128 字节。',
  'registration-closed': '此服务已关闭注册，请联系部署者创建账户。',
  'rate-limit': '操作过于频繁，请稍后重试。',
  'origin-rejected': '服务地址与后端配置不一致，请检查 REPEATY_ORIGIN。',
  'revision-conflict': '数据已在另一个页面更新，请刷新页面后重试。',
  'invalid-data': '服务拒绝了无效数据，本次修改未保存。',
  'storage-error': '服务数据库操作失败，请检查后端日志。',
  'not-found': '请求的数据已不存在，请刷新页面。',
  'request-failed': '无法连接服务，请检查后端是否正在运行。',
}
export class ServerError extends Error {
  constructor(readonly code: string) {
    super(messages[code] ?? code)
  }
}
export async function api(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers)
  headers.set('X-Repeaty-Client', '1')
  let response: Response
  try {
    response = await transport(path, { ...init, headers })
  } catch (error) {
    if (init.signal?.aborted) throw error
    throw new ServerError('request-failed')
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new ServerError(typeof body.error === 'string' ? body.error : 'request-failed')
  }
  return response
}
export async function apiJson<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await api(path, {
    method: body === undefined ? 'GET' : 'POST',
    ...(body === undefined
      ? {}
      : { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }),
    signal,
  })
  if (response.status === 204) return undefined as T
  try {
    return (await response.json()) as T
  } catch {
    throw new LocalizedError(msg('服务返回了无法读取的数据，请刷新后重试。'))
  }
}
