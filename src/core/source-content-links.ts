import type { Source } from './source-data'
import { inlineReferences } from './inline-media'

export interface SourceContentTarget {
  sourceId: string
  anchor?: string
}
export interface SourceResourceTarget {
  path: string
  mediaId: string
}
function decodeReference(url: string, scheme: string) {
  if (!url.startsWith(scheme) || url.length > 4096) return
  const [encoded = '', ...rest] = url.slice(scheme.length).split('#')
  try {
    const value = decodeURIComponent(encoded),
      anchor = rest.length ? decodeURIComponent(rest.join('#')) : undefined
    if (!value || /[\x00-\x1f]/.test(value) || (anchor && /[\x00-\x1f]/.test(anchor))) return
    return { value, anchor }
  } catch {
    return
  }
}
/** Only accepted identities in this connection and this exact document version can resolve. */
export function sourceContentLinks(
  source: Source | undefined,
  text: string,
  sources: readonly Source[] = [],
) {
  const links = new Map<string, SourceContentTarget>(),
    resources = new Map<string, SourceResourceTarget>()
  if (!source) return { links, resources }
  for (const reference of inlineReferences(text)) {
    const linked = decodeReference(reference.url, 'repeaty-source:')
    if (linked && source.binding) {
      const target = sources.find(
        (item) =>
          item.binding?.connectionId === source.binding!.connectionId &&
          item.binding.key === linked.value,
      )
      if (target) links.set(reference.url, { sourceId: target.id, anchor: linked.anchor })
    }
    const resource = decodeReference(reference.url, 'repeaty-resource:')
    if (resource) {
      const target = source.document?.resources?.find((item) => item.path === resource.value)
      if (target) resources.set(reference.url, { path: target.path, mediaId: target.mediaId })
    }
  }
  return { links, resources }
}
/** Obsidian heading/block anchors become exact offsets only after loading accepted text. */
export function sourceAnchorOffset(text: string, anchor: string) {
  const wanted = anchor.split('#').at(-1)!.normalize('NFC').toLocaleLowerCase()
  const slug = (value: string) =>
    value
      .normalize('NFC')
      .toLocaleLowerCase()
      .replace(/[\s]+/g, '-')
      .replace(/[^\p{L}\p{N}_-]/gu, '')
  let offset = 0,
    fence: string | undefined
  for (const line of text.split('\n')) {
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1]
    if (marker) {
      if (!fence) fence = marker
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = undefined
    } else if (!fence) {
      const heading = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(line)?.[1]
      if (
        heading &&
        (heading.normalize('NFC').toLocaleLowerCase() === wanted || slug(heading) === wanted)
      )
        return offset
      if (wanted.startsWith('^') && line.trimEnd().endsWith(wanted)) return offset
    }
    offset += line.length + 1
  }
  return undefined
}
