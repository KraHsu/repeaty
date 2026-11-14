import { parseFragment, type DefaultTreeAdapterMap } from 'parse5'
import type { ReadwiseContext } from './api'

export interface ExportDirectory {
  files: readonly { path: string; size: number }[]
  read(path: string): Promise<Blob>
}
const mime: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  ogg: 'audio/ogg',
  wav: 'audio/wav',
  pdf: 'application/pdf',
}
export function allowedPath(path: string) {
  return (
    !!path &&
    !/[\\:\x00-\x1f?#]/.test(path) &&
    !/(?:~|\.tmp|\.swp|\.bak)$/i.test(path) &&
    path
      .split('/')
      .every((part) => part && !part.startsWith('.') && !/^(node_modules|__MACOSX)$/i.test(part))
  )
}
function resolvePath(from: string, raw: string) {
  let target: string
  try {
    target = decodeURIComponent(raw.split(/[?#]/, 1)[0]!)
  } catch {
    return
  }
  if (!target || target.startsWith('/') || /[\\:\x00-\x1f?#]/.test(target)) return
  const parts = from.split('/').slice(0, -1)
  for (const part of target.split('/')) {
    if (part === '..') {
      if (!parts.length) return
      parts.pop()
    } else if (part && part !== '.') parts.push(part)
  }
  const result = parts.join('/')
  return allowedPath(result) ? result : undefined
}
const encodePath = (path: string) => path.split('/').map(encodeURIComponent).join('/')

/** Only URL destinations are replaced. Examples and original prose remain unchanged. */
function markdownResources(text: string, resolve: (url: string) => string | undefined) {
  const rewrite = (prose: string) => {
    const html = parseFragment(prose, { sourceCodeLocationInfo: true })
    const edits: { from: number; to: number; text: string }[] = []
    function visit(node: DefaultTreeAdapterMap['node']) {
      if ('tagName' in node && ['img', 'audio', 'source', 'a'].includes(node.tagName)) {
        const attribute = node.tagName === 'a' ? 'href' : 'src'
        const url = node.attrs.find((attr) => attr.name === attribute)?.value
        const location = node.sourceCodeLocation?.attrs?.[attribute]
        const target = url ? resolve(url) : undefined
        if (target && location)
          edits.push({
            from: location.startOffset,
            to: location.endOffset,
            text: `${attribute}="${target}"`,
          })
      }
      if ('childNodes' in node) node.childNodes.forEach(visit)
    }
    visit(html)
    for (const edit of edits.sort((a, b) => b.from - a.from))
      prose = prose.slice(0, edit.from) + edit.text + prose.slice(edit.to)
    return prose
      .replace(
        /(!?\[[^\]\n]*\]\(\s*)(<[^>\n]*>|(?:\\.|[^\\\s()]|\((?:\\.|[^\\()])*\))+)(?=\s*(?:["'][^"']*["']\s*)?\))/g,
        (whole, start: string, destination: string) => {
          const target = resolve(
            destination.startsWith('<')
              ? destination.slice(1, -1)
              : destination.replace(/\\([\W_])/g, '$1'),
          )
          return target ? `${start}${target}` : whole
        },
      )
      .replace(
        /^( {0,3}\[[^\]\n]+\]:\s*)(<[^>\n]*>|\S+)/gm,
        (whole, start: string, destination: string) => {
          const target = resolve(
            destination.startsWith('<') ? destination.slice(1, -1) : destination,
          )
          return target ? `${start}${target}` : whole
        },
      )
  }
  const inline = (prose: string) => {
    // A backtick run closes only with an equal run, including multi-line code spans.
    const spans = /(`+)([\s\S]*?)\1(?!`)/g
    let cursor = 0,
      output = ''
    for (const match of prose.matchAll(spans)) {
      output += rewrite(prose.slice(cursor, match.index)) + match[0]
      cursor = match.index + match[0].length
    }
    return output + rewrite(prose.slice(cursor))
  }
  let fence: string | undefined,
    prose = '',
    result = ''
  const flush = () => {
    result += inline(prose)
    prose = ''
  }
  for (const line of text.match(/[^\n]*\n|[^\n]+$/g) ?? []) {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1]
    if (fence) {
      result += line
      if (
        marker &&
        marker[0] === fence[0] &&
        marker.length >= fence.length &&
        /^ {0,3}(?:`+|~+)\s*$/.test(line)
      )
        fence = undefined
    } else if (marker || /^(?: {4}|\t)/.test(line)) {
      flush()
      result += line
      if (marker) fence = marker
    } else prose += line
  }
  flush()
  return result
}

export function directoryResources(
  directory: ExportDirectory,
  context: ReadwiseContext,
  charge: (bytes: number) => void,
) {
  const files = directory.files.filter((file) => allowedPath(file.path))
  const entries = new Map(files.map((file) => [file.path, file]))
  if (entries.size !== files.length) throw new Error('目录中存在重复路径，无法建立稳定来源。')
  const cache = new Map<string, Blob>()
  return (from: string) => {
    const paths = new Set<string>()
    const resolve = (url: string) => {
      const path = resolvePath(from, url)
      if (!path || !entries.has(path) || !mime[path.split('.').at(-1)!.toLowerCase()]) return
      paths.add(path)
      return `repeaty-resource:${encodePath(path)}`
    }
    return {
      resolve,
      markdown: (text: string) => markdownResources(text, resolve),
      async load() {
        const resources: { path: string; blob: Blob }[] = []
        for (const path of paths) {
          context.signal.throwIfAborted()
          let blob = cache.get(path)
          if (!blob) {
            if (entries.get(path)!.size > 10 * 1024 * 1024)
              throw new Error(`附件超过 10 MiB：${path}`)
            const raw = await directory.read(path)
            context.signal.throwIfAborted()
            if (raw.size > 10 * 1024 * 1024) throw new Error(`附件超过 10 MiB：${path}`)
            charge(raw.size)
            blob = raw.slice(0, raw.size, mime[path.split('.').at(-1)!.toLowerCase()])
            cache.set(path, blob)
          }
          resources.push({ path, blob })
        }
        return resources
      },
    }
  }
}
