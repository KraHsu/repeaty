import { LocalizedError, msg, type MessageKey } from '../i18n'
import { captureErrorKeys } from '../i18n/capture'

/** Keep catalog keys so errors and notifications follow later language changes. */
export function captureMessage(reason: unknown) {
  if (reason instanceof LocalizedError) return reason.detail
  const code = (reason instanceof Error ? reason.message : String(reason)).replace(/^Error: /, '')
  if (code === 'stale-collection-scope' || code === 'invalid-collection-scope')
    return msg('学习库已变化，请重新操作。')
  const key = captureErrorKeys[code]
  if (key) return msg(key)
  if (/^(capture|clipboard|selection)-/.test(code)) return msg('快捷收集暂时不可用，请重试。')
  // Domain errors may already be source-language catalog keys.
  return msg(code as MessageKey)
}
