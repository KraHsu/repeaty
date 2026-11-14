/** Container-relative names, never URLs or OS paths. */
export function cleanPath(value: string): string {
  if (!value || value.length > 2048 || /[\u0000-\u001f\\]/.test(value) || value.startsWith('/'))
    throw new Error('文档资源路径无效。')
  const parts = value.split('/')
  if (parts.some((part) => !part || part === '.' || part === '..' || part.includes(':')))
    throw new Error('文档资源路径无效。')
  return value
}
export function resolvePath(
  base: string,
  value: string,
): { path: string; fragment?: string } | undefined {
  value = value.trim()
  if (!value || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(value) || /[\u0000-\u001f\\]/.test(value))
    return undefined
  const hash = value.indexOf('#'),
    fragment = hash < 0 ? undefined : value.slice(hash + 1),
    address = (hash < 0 ? value : value.slice(0, hash)).split('?')[0]!
  try {
    const decoded = decodeURIComponent(address)
    if (decoded.startsWith('/') || decoded.includes('\\') || decoded.includes(':')) return undefined
    const parts = base.split('/').slice(0, -1)
    if (!decoded)
      return {
        path: cleanPath(base),
        ...(fragment ? { fragment: decodeURIComponent(fragment) } : {}),
      }
    for (const part of decoded.split('/')) {
      if (!part || part === '.') continue
      if (part === '..') {
        if (!parts.length) return undefined
        parts.pop()
      } else parts.push(part)
    }
    return {
      path: cleanPath(parts.join('/')),
      ...(fragment ? { fragment: decodeURIComponent(fragment) } : {}),
    }
  } catch {
    return undefined
  }
}
export function resourceType(path: string): string | undefined {
  const suffix = path.toLowerCase().split('.').at(-1)
  return (
    {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      webp: 'image/webp',
      mp3: 'audio/mpeg',
      wav: 'audio/wav',
      ogg: 'audio/ogg',
      m4a: 'audio/mp4',
    } as Record<string, string>
  )[suffix ?? '']
}
