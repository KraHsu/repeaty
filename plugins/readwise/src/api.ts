import { convertReadwise, record } from './content'

export type NativeHost = (operation: string, payload: unknown) => Promise<unknown>
export interface ReadwiseContext {
  signal: AbortSignal
  progress(value: { completed: number; total?: number; message?: string }): void
  yield(): Promise<void>
}
export const origin = 'https://readwise.io'
const slot = 'readwise'
export function abortableDelay(milliseconds: number, signal: AbortSignal) {
  signal.throwIfAborted()
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort)
      resolve()
    }, milliseconds)
    function abort() {
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
    }
    signal.addEventListener('abort', abort, { once: true })
  })
}
function response(value: unknown) {
  const parsed = record(value)
  if (
    !Number.isInteger(parsed.status) ||
    typeof parsed.body !== 'string' ||
    parsed.body.length > 1024 * 1024
  )
    throw new Error('Readwise 响应格式无效。')
  return {
    status: parsed.status as number,
    body: parsed.body,
    headers: record(parsed.headers),
    credentialRevision: parsed.credentialRevision,
    currentCredentialRevision: parsed.currentCredentialRevision,
  }
}
export function retryDelay(value: unknown) {
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0)
    return Math.min(120_000, Math.max(1000, seconds * 1000))
  const date = typeof value === 'string' ? Date.parse(value) : NaN
  return Number.isFinite(date) ? Math.min(120_000, Math.max(1000, date - Date.now())) : 5000
}
export function createReadwiseApi(native: NativeHost, wait = abortableDelay) {
  async function state() {
    const result = record(await native('secrets', { action: 'state' }))
    if (!Array.isArray(result.slots)) throw new Error('无法读取此设备的 Readwise 连接状态。')
    const entry = result.slots
      .map(record)
      .find((item) => item.slot === slot && item.origin === origin)
    if (!entry) return undefined
    if (!Number.isSafeInteger(entry.revision) || (entry.revision as number) < 0)
      throw new Error('Readwise 凭据状态无效。')
    return { revision: entry.revision as number }
  }
  async function configure(token: string | undefined) {
    if (token !== undefined && (!token || token.length > 4096 || /[^\x21-\x7e]/.test(token)))
      throw new Error('请填写完整的 Readwise access token，不要带空格或换行。')
    await native(
      'secrets',
      token === undefined
        ? { action: 'clear', slot }
        : { action: 'set', slot, origin, values: { token } },
    )
    return state()
  }
  async function get(path: string, revision: number, context: ReadwiseContext) {
    if (!/^\/api\/v[23]\/(?:auth|list|export)\//.test(path))
      throw new Error('不支持的 Readwise 请求。')
    for (let retry = 0; retry < 4; retry++) {
      context.signal.throwIfAborted()
      let raw: ReturnType<typeof response>
      try {
        raw = response(
          await native('http', {
            url: `${origin}${path}`,
            method: 'GET',
            secret: {
              slot,
              expectedRevision: revision,
              headers: { Authorization: 'Token {{token}}' },
            },
          }),
        )
      } catch (error) {
        context.signal.throwIfAborted()
        if (retry < 3 && error === 'plugin-network-error') {
          context.progress({ completed: 0, message: `连接中断，正在重试（${retry + 1}/3）…` })
          await wait(1000 * 2 ** retry, context.signal)
          continue
        }
        if (error === 'plugin-response-limit')
          throw new Error('Readwise 单次响应超过 1 MiB，请减少来源内容后重试。')
        throw error
      }
      context.signal.throwIfAborted()
      if (raw.credentialRevision !== revision || raw.currentCredentialRevision !== revision)
        throw new Error('Readwise 凭据已变更，请重新检查来源。')
      if (raw.status === 401 || raw.status === 403)
        throw new Error('Readwise token 无效、已过期或无权访问，请在设置中重新连接。')
      if ((raw.status === 429 || raw.status >= 500) && retry < 3) {
        const delay =
          raw.status === 429 ? retryDelay(raw.headers['retry-after']) : 1000 * 2 ** retry
        context.progress({
          completed: 0,
          message:
            raw.status === 429
              ? 'Readwise 限流，等待后自动重试…'
              : 'Readwise 暂时不可用，正在重试…',
        })
        await wait(delay, context.signal)
        continue
      }
      if (raw.status < 200 || raw.status >= 300)
        throw new Error(`Readwise 请求失败（HTTP ${raw.status}），已保留上次内容。`)
      return raw
    }
    throw new Error('Readwise 重试次数已用尽，请稍后重试。')
  }
  async function check(context: ReadwiseContext) {
    const configured = await state()
    if (!configured) throw new Error('请先在设置 → 连接 → Readwise 中保存 access token。')
    await get('/api/v2/auth/', configured.revision, context)
  }
  async function scan(mode: 'reader' | 'highlights' | 'both', context: ReadwiseContext) {
    const configured = await state()
    if (!configured) throw new Error('请先在设置 → 连接 → Readwise 中保存 access token。')
    const collected: { reader: unknown[]; books: unknown[] } = { reader: [], books: [] }
    let requests = 0
    for (const type of mode === 'both'
      ? (['reader', 'books'] as const)
      : mode === 'reader'
        ? (['reader'] as const)
        : (['books'] as const)) {
      let cursor: string | undefined
      const seen = new Set<string>()
      for (let page = 0; ; page++) {
        context.signal.throwIfAborted()
        if (page >= 250) throw new Error('Readwise 分页超过安全上限，本次检查未产生任何更新。')
        if (requests++) await wait(3100, context.signal)
        const query = new URLSearchParams(
          type === 'reader'
            ? { withHtmlContent: 'true', withRawSourceUrl: 'true', limit: '10' }
            : { includeDeleted: 'true' },
        )
        if (cursor) query.set('pageCursor', cursor)
        const raw = await get(
          `/api/${type === 'reader' ? 'v3/list' : 'v2/export'}/?${query}`,
          configured.revision,
          context,
        )
        let data: Record<string, unknown>
        try {
          data = record(JSON.parse(raw.body))
        } catch {
          throw new Error('Readwise 返回了无法解析的数据。')
        }
        if (!Array.isArray(data.results)) throw new Error('Readwise 分页缺少 results。')
        collected[type].push(...data.results)
        if (collected[type].length > 10_000)
          throw new Error('Readwise 记录超过安全上限，请减少接入范围。')
        context.progress({
          completed: collected.reader.length + collected.books.length,
          message: type === 'reader' ? '正在读取 Reader 正文…' : '正在读取 Readwise 高亮…',
        })
        await context.yield()
        if (
          data.nextPageCursor === null ||
          data.nextPageCursor === undefined ||
          data.nextPageCursor === ''
        )
          break
        if (
          typeof data.nextPageCursor !== 'string' ||
          data.nextPageCursor.length > 2048 ||
          seen.has(data.nextPageCursor)
        )
          throw new Error('Readwise 返回了重复或无效的分页游标。')
        cursor = data.nextPageCursor
        seen.add(cursor)
      }
    }
    context.signal.throwIfAborted()
    return convertReadwise(collected.reader, collected.books)
  }
  return { state, configure, check, scan }
}
