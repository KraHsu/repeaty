import { ZipReader, Uint8ArrayReader, type FileEntry } from '@zip.js/zip.js'
import { parse } from 'parse5'
import { attr, children, cleanHtml, find, tag, textOf, type HtmlNode } from './html'
import { cleanPath, resolvePath, resourceType } from './path'
import { limits, type DocumentBook, type RelatedFile } from './model'

export interface ParseContext {
  signal?: AbortSignal
  progress?: (completed: number, total: number, message: string) => void
}
function check(context: ParseContext) {
  context.signal?.throwIfAborted()
}
function decode(bytes: Uint8Array) {
  if (bytes.byteLength > limits.entryBytes) throw new Error('单个文档文件超过 8 MiB。')
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes)
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes)
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
}
function xml(bytes: Uint8Array) {
  const input = decode(bytes)
  if (/<!ENTITY\b/i.test(input)) throw new Error('不支持包含实体声明的文档。')
  return parse(input)
}
function required(value: string | undefined, description: string): string {
  if (!value) throw new Error(description)
  return value
}
export async function parseEpub(
  bytes: Uint8Array,
  name: string,
  context: ParseContext = {},
): Promise<DocumentBook> {
  if (bytes.length > limits.fileBytes) throw new Error('EPUB 超过 32 MiB，请拆分后导入。')
  check(context)
  const reader = new ZipReader(new Uint8ArrayReader(bytes), {
    useWebWorkers: false,
    strictness: 'strict',
    filenameValidation: 'strict',
  })
  try {
    const entries = await reader.getEntries(),
      files = new Map<string, FileEntry>()
    if (entries.length > limits.entries) throw new Error('EPUB 文件数量超过限制。')
    let total = 0
    for (const entry of entries) {
      check(context)
      cleanPath(entry.directory ? entry.filename.replace(/\/$/, '') : entry.filename)
      if (entry.encrypted) throw new Error('不支持加密 EPUB。')
      if (entry.directory) continue
      if (files.has(entry.filename)) throw new Error('EPUB 包含重复路径。')
      if (
        !Number.isSafeInteger(entry.uncompressedSize) ||
        entry.uncompressedSize > limits.entryBytes
      )
        throw new Error('EPUB 单个文件超过 8 MiB。')
      total += entry.uncompressedSize
      if (total > limits.totalBytes) throw new Error('EPUB 解压大小超过 64 MiB。')
      files.set(entry.filename, entry)
    }
    if (files.has('META-INF/encryption.xml')) throw new Error('此 EPUB 包含加密资源，暂不支持。')
    const read = async (path: string) => {
      check(context)
      const file = files.get(path)
      if (!file) throw new Error(`EPUB 缺少文件：${path}`)
      const chunks: Uint8Array[] = []
      let size = 0
      await file.getData(
        new WritableStream<Uint8Array>({
          write(chunk) {
            size += chunk.byteLength
            if (size > limits.entryBytes || size > file.uncompressedSize)
              throw new Error('EPUB 解压大小与声明不符。')
            chunks.push(chunk)
          },
        }),
        { useWebWorkers: false, checkSignature: true, signal: context.signal },
      )
      const data = new Uint8Array(size)
      let offset = 0
      for (const chunk of chunks) {
        data.set(chunk, offset)
        offset += chunk.byteLength
      }
      check(context)
      if (data.byteLength !== file.uncompressedSize || data.byteLength > limits.entryBytes)
        throw new Error('EPUB 解压大小与声明不符。')
      return data
    }
    if (decode(await read('mimetype')).trim() !== 'application/epub+zip')
      throw new Error('文件不是有效的 EPUB。')
    const container = xml(await read('META-INF/container.xml'))
    const rootfile = find(container, 'rootfile')[0]
    const packagePath = cleanPath(
      required(rootfile && attr(rootfile, 'full-path'), 'EPUB 缺少 package 路径。'),
    )
    const opf = xml(await read(packagePath)),
      manifest = new Map<string, { path: string; type: string; properties: string }>()
    for (const item of find(opf, 'item')) {
      const id = attr(item, 'id'),
        href = resolvePath(packagePath, attr(item, 'href') ?? '')
      if (!id || !href || manifest.has(id)) throw new Error('EPUB manifest 路径或标识无效。')
      manifest.set(id, {
        path: href.path,
        type: attr(item, 'media-type') ?? '',
        properties: attr(item, 'properties') ?? '',
      })
    }
    const spine = find(opf, 'itemref').map((item) => {
      const found = manifest.get(attr(item, 'idref') ?? '')
      if (!found || !['application/xhtml+xml', 'text/html'].includes(found.type))
        throw new Error('EPUB 包含无法阅读的章节类型。')
      return found.path
    })
    if (!spine.length || spine.length > limits.chapters || new Set(spine).size !== spine.length)
      throw new Error('EPUB 需要 1–99 个不重复的正文章节。')
    const titleNode = find(opf, 'dc:title')[0] ?? find(opf, 'title')[0]
    const title = titleNode ? textOf(titleNode).trim().slice(0, 200) : name.replace(/\.epub$/i, '')
    const available = new Set([...files.keys()].filter((path) => resourceType(path)))
    const book: DocumentBook = {
      kind: 'epub',
      title: title || name,
      chapters: [],
      toc: [],
      resources: [],
      warnings: [],
    }
    for (let index = 0; index < spine.length; index++) {
      const path = spine[index]!
      context.progress?.(index, spine.length, `读取章节 ${index + 1} / ${spine.length}`)
      const cleaned = cleanHtml(decode(await read(path)), path, available, `第 ${index + 1} 章`)
      book.chapters.push(cleaned.chapter)
      book.resources.push(...cleaned.embedded)
      if (cleaned.missing.length)
        book.warnings.push(
          `${cleaned.chapter.title}：${cleaned.missing.length} 个外部或缺失资源未加载。`,
        )
    }
    const used = new Set(book.chapters.flatMap((chapter) => chapter.resources))
    if (used.size > limits.resources) throw new Error('文档资源超过 512 个。')
    for (const path of used)
      if (files.has(path))
        book.resources.push({ path, bytes: await read(path), type: resourceType(path)! })
    const nav = [...manifest.values()].find((item) => item.properties.split(/\s+/).includes('nav'))
    const tocPath =
      nav?.path ??
      [...manifest.values()].find((item) => item.type === 'application/x-dtbncx+xml')?.path
    if (tocPath) {
      const document = xml(await read(tocPath))
      const navNode =
        find(document, 'nav').find((node) =>
          (attr(node, 'epub:type') ?? attr(node, 'type'))?.split(/\s+/).includes('toc'),
        ) ?? find(document, 'nav')[0]
      const push = (label: string, href: string, depth: number) => {
        const target = resolvePath(tocPath, href)
        if (target && spine.includes(target.path) && label.trim() && book.toc.length < 1000)
          book.toc.push({ title: label.trim().slice(0, 200), ...target, depth: Math.min(depth, 8) })
      }
      const visit = (node: HtmlNode, depth: number, level = 0) => {
        if (level > 128) throw new Error('EPUB 目录结构过深。')
        if (tag(node) === 'a') push(textOf(node), attr(node, 'href') ?? '', depth)
        for (const child of children(node))
          visit(child, depth + (tag(node) === 'li' ? 1 : 0), level + 1)
      }
      if (navNode) visit(navNode, 0)
      else
        for (const point of find(document, 'navpoint')) {
          const label = find(point, 'navlabel')[0],
            content = find(point, 'content')[0]
          if (label && content) push(textOf(label), attr(content, 'src') ?? '', 0)
        }
    }
    if (!book.toc.length)
      book.toc = book.chapters.map((chapter) => ({
        title: chapter.title,
        path: chapter.path,
        depth: 0,
      }))
    context.progress?.(spine.length, spine.length, '章节与资源已准备好')
    return book
  } finally {
    await reader.close()
  }
}

export async function parseHtml(
  bytes: Uint8Array,
  path: string,
  related: RelatedFile[],
  context: ParseContext = {},
): Promise<DocumentBook> {
  check(context)
  cleanPath(path)
  if (related.length > limits.resources) throw new Error('配套资源超过 512 个。')
  const resources = new Map<string, RelatedFile>()
  let total = bytes.byteLength
  for (const file of related) {
    check(context)
    cleanPath(file.path)
    if (resources.has(file.path)) throw new Error('配套资源包含重复路径。')
    total += file.bytes.byteLength
    if (file.bytes.byteLength > limits.entryBytes || total > limits.totalBytes)
      throw new Error('HTML 配套资源超过大小限制。')
    if (resourceType(file.path)) resources.set(file.path, file)
  }
  // A directory picker includes its selected root name; a separately selected HTML file does not.
  // Offer root-relative aliases only for a single common chosen folder, without replacing exact paths.
  if (!path.includes('/') && related.length && related.every((file) => file.path.includes('/'))) {
    const root = related[0]!.path.split('/')[0]! + '/'
    if (related.every((file) => file.path.startsWith(root)))
      for (const [name, file] of [...resources]) {
        const relative = name.slice(root.length)
        if (!resources.has(relative)) resources.set(relative, file)
      }
  }
  const cleaned = cleanHtml(
    decode(bytes),
    path,
    new Set(resources.keys()),
    path
      .split('/')
      .at(-1)!
      .replace(/\.html?$/i, ''),
  )
  return {
    kind: 'html',
    title: cleaned.chapter.title,
    url: cleaned.url,
    chapters: [cleaned.chapter],
    toc: [],
    resources: [
      ...cleaned.embedded,
      ...cleaned.chapter.resources.flatMap((path) => {
        const file = resources.get(path)
        return file ? [{ path, bytes: file.bytes, type: resourceType(path)! }] : []
      }),
    ],
    warnings: cleaned.missing.length
      ? [`${cleaned.missing.length} 个外部或缺失资源未加载；可重新选择配套资源后导入。`]
      : [],
  }
}
