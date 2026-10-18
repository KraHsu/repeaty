export type Site = 'leetcode.cn' | 'leetcode.com'
export type Request =
  | { action: 'ping' }
  | { action: 'question'; site: Site; slug: string }
  | { action: 'submit'; site: Site; slug: string; questionId: string; lang: string; code: string }
  | { action: 'check'; site: Site; submissionId: string }

export function allowedPage(value: string): boolean {
  try {
    const url = new URL(value)
    if (url.username || url.password) return false
    if (
      ['http:', 'https:'].includes(url.protocol) &&
      ['127.0.0.1', 'localhost'].includes(url.hostname)
    )
      return true
    return (
      url.protocol === 'https:' &&
      !url.port &&
      ['www.krahsu.top', 'krahsu.top', 'krahsu.github.io'].includes(url.hostname) &&
      url.pathname.startsWith('/repeaty/')
    )
  } catch {
    return false
  }
}
export function validRequest(value: unknown): value is Request {
  if (!value || typeof value !== 'object') return false
  const r = value as Record<string, unknown>
  if (r.action === 'ping') return true
  if (r.site !== 'leetcode.cn' && r.site !== 'leetcode.com') return false
  if (r.action === 'check')
    return typeof r.submissionId === 'string' && /^\d{1,30}$/.test(r.submissionId)
  if (
    typeof r.slug !== 'string' ||
    r.slug.length > 160 ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(r.slug)
  )
    return false
  if (r.action === 'question') return true
  return (
    r.action === 'submit' &&
    typeof r.questionId === 'string' &&
    /^\d{1,30}$/.test(r.questionId) &&
    typeof r.lang === 'string' &&
    /^[a-z0-9-]{1,40}$/.test(r.lang) &&
    typeof r.code === 'string' &&
    r.code.trim().length > 0 &&
    r.code.length <= 50000
  )
}
