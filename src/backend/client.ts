import { LocalizedError, msg } from '../i18n'

let token = ''
try {
  token = sessionStorage.getItem('repeaty.server.token') ?? ''
} catch {
  /* Memory-only session. */
}
export function setServerToken(value: string) {
  token = value.trim()
  try {
    sessionStorage.setItem('repeaty.server.token', token)
  } catch {
    /* Memory-only session. */
  }
}
const messages: Record<string, string> = {
  unauthorized: '请输入正确的服务访问密钥。',
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
  if (token) headers.set('Authorization', `Bearer ${token}`)
  let response: Response
  try {
    response = await fetch(`/api${path}`, {
      ...init,
      headers,
      credentials: 'same-origin',
      cache: 'no-store',
    })
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
