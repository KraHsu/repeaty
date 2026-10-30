export interface VaultDirectory {
  files: readonly { path: string; size: number }[]
  read(path: string): Promise<Blob>
}
export interface ScanContext {
  signal: AbortSignal
  progress(value: { completed: number; total?: number; message?: string }): void
  yield(): Promise<void>
}
export interface VaultItem {
  key: string
  title: string
  text: string
  format: 'markdown'
  path: string
  resources: { path: string; blob: Blob }[]
  links: { targetKey: string; label?: string; anchor?: string }[]
}
const maxCharacters = 250_000
const maxResourceBytes = 10 * 1024 * 1024
const maxBatchBytes = 128 * 1024 * 1024
const mediaPattern = /\.(?:png|jpe?g|gif|webp|mp3|m4a|ogg|wav|pdf)$/i
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
export function safePath(input: string): string | undefined {
  const path = input.replaceAll('\\', '/')
  if (!path || path.startsWith('/') || /[\x00-\x1f:#?]/.test(path)) return
  const parts = path.split('/')
  if (
    parts.some(
      (part) =>
        !part ||
        part === '.' ||
        part === '..' ||
        part.startsWith('.') ||
        /^(?:node_modules|__MACOSX)$/i.test(part),
    )
  )
    return
  if (/(?:~|\.tmp|\.swp|\.bak)$/i.test(path)) return
  return path
}
function resolveRelative(from: string, target: string) {
  const parts = from.split('/').slice(0, -1)
  for (const part of target.replaceAll('\\', '/').split('/')) {
    if (part === '..') {
      if (!parts.length) return
      parts.pop()
    } else if (part && part !== '.') parts.push(part)
  }
  return safePath(parts.join('/'))
}
function escapedLabel(value: string) {
  return value.replace(/([\\\[\]])/g, '\\$1')
}
function encodePath(path: string) {
  return path.split('/').map(encodeURIComponent).join('/')
}
/** Exact vault path first; an ambiguous short name is deliberately left unresolved. */
export function resolveVaultLink(from: string, raw: string, paths: ReadonlySet<string>) {
  let target: string
  try {
    target = decodeURIComponent(raw)
  } catch {
    return
  }
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(target)) return
  if (!target) return from
  const options = /\.[^/]+$/.test(target) ? [target] : [target, `${target}.md`]
  for (const option of options) {
    const rooted = safePath(option)
    if (rooted && paths.has(rooted)) return rooted
    const relative = resolveRelative(from, option)
    if (relative && paths.has(relative)) return relative
  }
  const matches = [...paths].filter((path) =>
    options.some((option) => path.endsWith(`/${option}`) || path === option),
  )
  return matches.length === 1 ? matches[0] : undefined
}
/** Rewrite only prose: fenced/inline code examples remain exact. */
export function convertLinks(text: string, path: string, paths: ReadonlySet<string>) {
  const resources = new Set<string>()
  const links: VaultItem['links'] = []
  let fence: string | undefined
  const rewrite = (segment: string) => {
    const link = (embed: boolean, destination: string, label?: string, wiki = false) => {
      const [target = '', ...anchors] = destination.split('#')
      const anchor = anchors.join('#') || undefined
      const resolved = resolveVaultLink(path, target, paths)
      if (!resolved) return undefined
      const display = label || target.split('/').at(-1)?.replace(/\.md$/i, '') || anchor || path
      if (/\.md$/i.test(resolved)) {
        links.push({ targetKey: resolved, label: display, ...(anchor ? { anchor } : {}) })
        return `[${escapedLabel(display)}](repeaty-source:${encodeURIComponent(resolved)}${anchor ? `#${encodeURIComponent(anchor)}` : ''})`
      }
      if (!mediaPattern.test(resolved)) return undefined
      resources.add(resolved)
      // Obsidian image aliases may specify a width, which is not meaningful alt text.
      const alt = wiki && /^\d+(?:x\d+)?$/.test(display) ? resolved.split('/').at(-1)! : display
      if (embed && /\.(?:mp3|m4a|ogg|wav)$/i.test(resolved))
        return `<audio controls src="repeaty-resource:${encodePath(resolved)}"></audio>`
      return `${embed && /\.(?:png|jpe?g|gif|webp)$/i.test(resolved) ? '!' : ''}[${escapedLabel(alt)}](repeaty-resource:${encodePath(resolved)}${anchor ? `#${encodeURIComponent(anchor)}` : ''})`
    }
    return segment
      .replace(/(!?)\[\[([^\]\n]+)\]\]/g, (whole, bang: string, value: string) => {
        const separator = value.indexOf('|')
        return (
          link(
            !!bang,
            separator < 0 ? value : value.slice(0, separator),
            separator < 0 ? undefined : value.slice(separator + 1),
            true,
          ) ?? whole
        )
      })
      .replace(
        /(!?)\[([^\]\n]*)\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g,
        (whole, bang: string, label: string, value: string) => link(!!bang, value, label) ?? whole,
      )
  }
  const converted = text
    .split('\n')
    .map((line) => {
      const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1]
      if (marker) {
        if (!fence) fence = marker
        else if (marker[0] === fence[0] && marker.length >= fence.length) fence = undefined
        return line
      }
      if (fence) return line
      return line
        .split(/(`+[^`]*`+)/g)
        .map((part) => (part.startsWith('`') ? part : rewrite(part)))
        .join('')
    })
    .join('\n')
  return { text: converted, resources: [...resources], links }
}
export async function scanVault(directory: VaultDirectory, context: ScanContext) {
  const files = directory.files.filter((file) => safePath(file.path) === file.path)
  const paths = new Set(files.map((file) => file.path))
  const notes = files
    .filter((file) => /\.md$/i.test(file.path))
    .sort((a, b) => a.path.localeCompare(b.path, 'en'))
  if (notes.length > 1000) throw new Error('笔记库超过 1,000 篇，请连接更小的子目录。')
  if (paths.size !== files.length) throw new Error('目录中存在重复路径，无法建立稳定来源。')
  const items: VaultItem[] = []
  const cache = new Map<string, Blob>()
  let totalBytes = 0
  for (const note of notes) {
    context.signal.throwIfAborted()
    if (note.size > 1024 * 1024) throw new Error(`笔记过大：${note.path}`)
    const blob = await directory.read(note.path)
    context.signal.throwIfAborted()
    if (blob.size > 1024 * 1024) throw new Error(`笔记过大：${note.path}`)
    const text = new TextDecoder('utf-8', { fatal: true })
      .decode(await blob.arrayBuffer())
      .replaceAll('\r\n', '\n')
    if (!text.trim()) throw new Error(`笔记暂时为空，请保存正文后重试：${note.path}`)
    if (text.length > maxCharacters) throw new Error(`笔记超过 250,000 字符：${note.path}`)
    totalBytes += blob.size
    const converted = convertLinks(text, note.path, paths)
    const resources: VaultItem['resources'] = []
    for (const path of converted.resources) {
      context.signal.throwIfAborted()
      let asset = cache.get(path)
      if (!asset) {
        const metadata = files.find((file) => file.path === path)!
        if (metadata.size > maxResourceBytes) throw new Error(`附件超过 10 MiB：${path}`)
        const raw = await directory.read(path)
        if (raw.size > maxResourceBytes) throw new Error(`附件超过 10 MiB：${path}`)
        asset = raw.slice(0, raw.size, mime[path.split('.').at(-1)!.toLowerCase()] || raw.type)
        cache.set(path, asset)
        totalBytes += asset.size
      }
      resources.push({ path, blob: asset })
    }
    if (totalBytes > maxBatchBytes) throw new Error('本次来源检查超过 128 MiB，请缩小目录范围。')
    const title =
      /^#\s+(.+)$/m.exec(text)?.[1]?.trim() || note.path.split('/').at(-1)!.replace(/\.md$/i, '')
    items.push({
      key: note.path,
      path: note.path,
      title: title.slice(0, 160),
      text: converted.text,
      format: 'markdown',
      resources,
      links: converted.links,
    })
    context.progress({ completed: items.length, total: notes.length, message: note.path })
    await context.yield()
  }
  context.signal.throwIfAborted()
  return { items, complete: true }
}
