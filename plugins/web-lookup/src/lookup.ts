export interface LookupTarget {
  id: string
  label: string
  template: string
  enabled: boolean
}
export function defaults(): LookupTarget[] {
  return [
    {
      id: 'duckduckgo',
      label: 'DuckDuckGo',
      template: 'https://duckduckgo.com/?q={text}',
      enabled: true,
    },
    {
      id: 'google',
      label: 'Google',
      template: 'https://www.google.com/search?q={text}',
      enabled: true,
    },
    {
      id: 'wikipedia',
      label: 'Wikipedia',
      template: 'https://en.wikipedia.org/w/index.php?search={text}',
      enabled: true,
    },
    { id: 'chatgpt', label: 'ChatGPT', template: 'https://chatgpt.com/?q={text}', enabled: true },
  ]
}
export function lookupUrl(template: string, text: string): string {
  if (!text.trim() || text.length > 10000) throw new Error('请选择 1 至 10000 个字符。')
  if (template.length > 2048 || !template.includes('{text}'))
    throw new Error('网址必须包含 {text} 占位符。')
  const base = new URL(template.replaceAll('{text}', 'QUERY'))
  if (
    base.protocol !== 'https:' ||
    base.username ||
    base.password ||
    !base.hostname.includes('.') ||
    /[{}]/.test(base.origin) ||
    template.split('://')[1]?.split(/[/?#]/)[0]?.includes('{text}')
  )
    throw new Error('请使用固定网站的 HTTPS 网址，不要填写登录信息。')
  const url = template.replaceAll('{text}', encodeURIComponent(text))
  if (url.length > 24000) throw new Error('查询内容过长，请缩短选区。')
  return url
}
export function normalizeTargets(value: unknown): LookupTarget[] {
  if (!Array.isArray(value) || value.length > 32)
    throw new Error('查询目标无效，最多可配置 32 项。')
  const ids = new Set<string>()
  return value.map((entry: LookupTarget) => {
    if (
      !entry ||
      typeof entry.id !== 'string' ||
      !/^[a-z0-9-]{1,64}$/.test(entry.id) ||
      ids.has(entry.id) ||
      typeof entry.label !== 'string' ||
      !entry.label.trim() ||
      entry.label.length > 80 ||
      typeof entry.template !== 'string' ||
      typeof entry.enabled !== 'boolean'
    )
      throw new Error('请填写有效且不重复的查询目标。')
    lookupUrl(entry.template, 'test')
    ids.add(entry.id)
    return {
      id: entry.id,
      label: entry.label.trim(),
      template: entry.template.trim(),
      enabled: entry.enabled,
    }
  })
}
