export function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}
export function siteUrl(input: string) {
  const url = new URL(input.trim())
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
    throw new Error('invalid-site')
  return url.href.replace(/\/+$/, '')
}
export function id(input: unknown): string {
  if (
    (typeof input !== 'number' && typeof input !== 'string') ||
    !/^[1-9]\d{0,15}$/.test(String(input))
  )
    throw new Error('invalid-response')
  return String(input)
}
export function safeUrl(input: unknown, site: string): string {
  if (typeof input !== 'string') throw new Error('invalid-response')
  const url = new URL(input, site)
  if (
    url.protocol !== 'https:' ||
    url.origin !== new URL(site).origin ||
    url.username ||
    url.password
  )
    throw new Error('invalid-response')
  return url.href
}
export function utf8Base64(value: string): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(value)))
}
export async function fingerprint(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value))
  const hash = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
export async function publicationMarker(site: string, sourceId: string) {
  return `repeaty-${(await fingerprint([site, sourceId])).slice(0, 40)}`
}
export function markerComment(marker: string) {
  if (!/^repeaty-[a-f0-9]{40}$/.test(marker)) throw new Error('invalid-marker')
  return `<!-- ${marker} -->`
}
export function marked(content: string, marker: string) {
  return `${content.trim()}\n\n${markerComment(marker)}`
}
export function hasMarker(content: string, marker: string) {
  return content.includes(markerComment(marker))
}
