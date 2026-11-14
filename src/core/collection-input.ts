/** User-selected input only. Collection never obtains ambient filesystem access or writes files. */
export interface CollectionFile {
  file: File
  path: string
}
export interface CollectionInputIssue {
  path: string
  reason: 'private' | 'temporary' | 'unsafe-path' | 'duplicate-path' | 'unreadable' | 'limit'
}
export interface CollectionInput {
  files: CollectionFile[]
  issues: CollectionInputIssue[]
  bytes: number
  text?: string
}
export interface CollectionLimits {
  files: number
  entries: number
  bytes: number
  depth: number
}
export const COLLECTION_LIMITS: Readonly<CollectionLimits> = {
  files: 2000,
  entries: 10_000,
  bytes: 128 * 1024 * 1024,
  depth: 32,
}
const privateDirectories = new Set([
  'node_modules',
  '__pycache__',
  '$recycle.bin',
  'system volume information',
])
const temporaryFile = /(?:^(?:~\$|~)|(?:\.tmp|\.temp|\.swp|\.swo|\.bak|~)$)/i

/** Returns a portable relative path, or a reason the selected path must be skipped. */
export function inspectCollectionPath(
  value: string,
): { path: string } | { reason: CollectionInputIssue['reason'] } {
  if (
    !value ||
    value.length > 2048 ||
    /[\\:\u0000-\u001f]/.test(value) ||
    value.startsWith('/') ||
    value.split('/').some((part) => !part || part === '.' || part === '..')
  )
    return { reason: 'unsafe-path' }
  const parts = value.split('/')
  if (parts.some((part) => part.startsWith('.') || privateDirectories.has(part.toLowerCase())))
    return { reason: 'private' }
  if (parts.some((part) => temporaryFile.test(part))) return { reason: 'temporary' }
  return { path: value }
}

function checkAbort(signal?: AbortSignal) {
  signal?.throwIfAborted()
}
function collector(limits: CollectionLimits, signal?: AbortSignal) {
  const result: CollectionInput = { files: [], issues: [], bytes: 0 }
  const paths = new Set<string>()
  let entries = 0,
    exhausted = false
  function visit(path: string): boolean {
    checkAbort(signal)
    if (exhausted) return false
    if (++entries > limits.entries || result.files.length >= limits.files) {
      exhausted = true
      result.issues.push({ path, reason: 'limit' })
      return false
    }
    const inspected = inspectCollectionPath(path)
    if ('reason' in inspected) {
      result.issues.push({ path, reason: inspected.reason })
      return false
    }
    if (path.split('/').length > limits.depth) {
      result.issues.push({ path, reason: 'limit' })
      return false
    }
    return true
  }
  function add(file: File, path: string) {
    checkAbort(signal)
    if (paths.has(path)) {
      result.issues.push({ path, reason: 'duplicate-path' })
      return
    }
    if (
      !Number.isSafeInteger(file.size) ||
      file.size < 0 ||
      file.size > limits.bytes - result.bytes
    ) {
      result.issues.push({ path, reason: 'limit' })
      return
    }
    paths.add(path)
    result.files.push({ file, path })
    result.bytes += file.size
  }
  return { result, visit, add, exhausted: () => exhausted }
}

/** No body reads: format preview and directory filtering are cheap even for large documents. */
export function collectSelectedFiles(
  files: Iterable<File>,
  options: { signal?: AbortSignal; limits?: CollectionLimits } = {},
): CollectionInput {
  const state = collector(options.limits ?? COLLECTION_LIMITS, options.signal)
  for (const file of files) {
    const path = file.webkitRelativePath || file.name
    if (state.visit(path)) state.add(file, path)
    if (state.exhausted()) break
  }
  return state.result
}

/** Narrow browser entry contract also makes paginated Chromium directory enumeration testable. */
export interface CollectionEntry {
  name: string
  isFile: boolean
  isDirectory: boolean
  file?: (success: (file: File) => void, error: (error: DOMException) => void) => void
  createReader?: () => {
    readEntries: (
      success: (entries: CollectionEntry[]) => void,
      error: (error: DOMException) => void,
    ) => void
  }
}
export async function collectDroppedEntries(
  roots: readonly CollectionEntry[],
  options: { signal?: AbortSignal; limits?: CollectionLimits } = {},
): Promise<CollectionInput> {
  const state = collector(options.limits ?? COLLECTION_LIMITS, options.signal)
  const visit = async (entry: CollectionEntry, parent: string) => {
    const path = parent ? `${parent}/${entry.name}` : entry.name
    if (!state.visit(path)) return
    try {
      if (entry.isFile && !entry.isDirectory && entry.file) {
        const file = await new Promise<File>((resolve, reject) => entry.file!(resolve, reject))
        checkAbort(options.signal)
        state.add(file, path)
      } else if (entry.isDirectory && !entry.isFile && entry.createReader) {
        const reader = entry.createReader()
        while (!state.exhausted()) {
          checkAbort(options.signal)
          const entries = await new Promise<CollectionEntry[]>((resolve, reject) =>
            reader.readEntries(resolve, reject),
          )
          checkAbort(options.signal)
          if (!entries.length) break
          for (const child of entries) {
            await visit(child, path)
            if (state.exhausted()) break
          }
        }
      } else state.result.issues.push({ path, reason: 'unreadable' })
    } catch (error) {
      checkAbort(options.signal)
      if (error instanceof DOMException && error.name === 'AbortError') throw error
      state.result.issues.push({ path, reason: 'unreadable' })
    }
  }
  for (const entry of roots) {
    await visit(entry, '')
    if (state.exhausted()) break
  }
  return state.result
}

/** Call synchronously inside the drop/paste handler, before the browser clears its data store. */
export function collectDataTransfer(
  transfer: DataTransfer,
  options: { signal?: AbortSignal; limits?: CollectionLimits } = {},
): Promise<CollectionInput> {
  const text = transfer.getData('text/plain')
  const entries = Array.from(transfer.items ?? [])
    .filter((item) => item.kind === 'file')
    .map((item) => item.webkitGetAsEntry?.() as CollectionEntry | null)
  const files = Array.from(transfer.files ?? [])
  const collected =
    entries.length && entries.every((entry) => !!entry)
      ? collectDroppedEntries(entries as CollectionEntry[], options)
      : Promise.resolve(collectSelectedFiles(files, options))
  return collected.then((result) => ({ ...result, ...(text ? { text } : {}) }))
}

export interface CollectionFormat {
  id: string
  title: string
  extensions: readonly string[]
}
export interface DetectedCollectionFile extends CollectionFile {
  /** Multiple matches require an explicit user choice, never installation-order dispatch. */
  formats: readonly CollectionFormat[]
}
export function detectCollectionFormats(
  files: readonly CollectionFile[],
  formats: readonly CollectionFormat[],
): DetectedCollectionFile[] {
  return files.map((entry) => ({
    ...entry,
    formats: formats.filter((format) =>
      format.extensions.some((suffix) => entry.path.toLowerCase().endsWith(suffix.toLowerCase())),
    ),
  }))
}

export interface ReadableClipboardItem {
  types: readonly string[]
  getType(type: string): Promise<Blob>
}
/** Clipboard reads must originate from an explicit user action; clipboard contents are never changed. */
export async function readCollectionClipboard(
  read: () => Promise<readonly ReadableClipboardItem[]>,
  options: { signal?: AbortSignal; limits?: CollectionLimits } = {},
): Promise<CollectionInput> {
  checkAbort(options.signal)
  const items = await read()
  checkAbort(options.signal)
  const state = collector(options.limits ?? COLLECTION_LIMITS, options.signal)
  const texts: string[] = []
  for (const [index, item] of items.entries()) {
    if (index >= (options.limits ?? COLLECTION_LIMITS).entries) {
      state.result.issues.push({ path: 'clipboard', reason: 'limit' })
      break
    }
    checkAbort(options.signal)
    if (item.types.includes('text/plain')) {
      const blob = await item.getType('text/plain')
      checkAbort(options.signal)
      if (blob.size > (options.limits ?? COLLECTION_LIMITS).bytes - state.result.bytes)
        throw new Error('剪贴板内容超过本次收集的大小限制。')
      const text = await blob.text()
      checkAbort(options.signal)
      texts.push(text)
      state.result.bytes += blob.size
    }
    const mime = item.types.find((type) => ['image/png', 'image/jpeg', 'image/webp'].includes(type))
    if (mime) {
      const path = `clipboard-${index + 1}.${mime.split('/')[1]}`
      if (!state.visit(path)) continue
      const blob = await item.getType(mime)
      checkAbort(options.signal)
      state.add(new File([blob], path, { type: mime }), path)
    }
  }
  return { ...state.result, ...(texts.length ? { text: texts.join('\n\n') } : {}) }
}
