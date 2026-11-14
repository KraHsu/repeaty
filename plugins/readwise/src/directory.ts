import { parseDocument } from 'yaml'
import {
  convertReadwise,
  htmlToMarkdown,
  identity,
  record,
  safeUrl,
  string,
  type ReadwiseItem,
} from './content'
import type { ReadwiseContext } from './api'
import { allowedPath, directoryResources, type ExportDirectory } from './resources'

function mergeResources(...groups: ReadwiseItem['resources'][]) {
  return [
    ...new Map(
      groups.flatMap((group) => (group ?? []).map((item) => [item.path, item] as const)),
    ).values(),
  ]
}
function metadata(text: string) {
  const front = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(text)
  if (!front) return {}
  if (front[1]!.length > 64 * 1024) throw new Error('Readwise 导出元数据过大。')
  const parsed = parseDocument(front[1]!, { uniqueKeys: true })
  if (parsed.errors.length) throw new Error('Readwise 导出元数据格式无效。')
  return record(parsed.toJS({ maxAliasCount: 20 }))
}
function knownKey(value: Record<string, unknown>, text: string) {
  if (value.reader_id) return `reader:${identity(value.reader_id)}`
  if (value.user_book_id || value.book_id)
    return `book:${identity(value.user_book_id || value.book_id)}`
  const url =
    string(value.readwise_url) ||
    string(value.url) ||
    /https:\/\/(?:read\.)?readwise\.io\/[^\s)\]>]+/.exec(text)?.[0] ||
    ''
  const reader =
    /^https:\/\/(?:read\.)?readwise\.io\/(?:reader\/read|(?:new|later|archive|feed)\/read|read)\/([\w-]+)/.exec(
      url,
    )
  if (reader) return `reader:${reader[1]}`
  const book = /^https:\/\/readwise\.io\/bookreview\/(\d+)/.exec(url)
  return book ? `book:${book[1]}` : undefined
}
export async function scanExportDirectory(directory: ExportDirectory, context: ReadwiseContext) {
  let bytes = 0
  const charge = (size: number) => {
    if ((bytes += size) > 128 * 1024 * 1024) throw new Error('Readwise 导出超过本次检查大小限制。')
  }
  const resourcesFor = directoryResources(directory, context, charge)
  const relativeKey = (path: string) =>
    path
      .replace(/(^|\/)Full Document Contents\//i, '$1')
      .replace(/\.(?:md|txt|html?|epub|pdf)$/i, '')
  const originals = new Map<string, NonNullable<ReadwiseItem['original']>>()
  for (const file of directory.files) {
    if (!allowedPath(file.path) || !/\.(?:epub|pdf)$/i.test(file.path)) continue
    if (file.size > 64 * 1024 * 1024) throw new Error(`Readwise 原件超过 64 MiB：${file.path}`)
    const key = relativeKey(file.path)
    if (originals.has(key)) throw new Error(`同一材料有多个原件：${key}。请选择一种原件格式。`)
    originals.set(key, {
      path: file.path,
      name: file.path.split('/').at(-1)!,
      format: /\.epub$/i.test(file.path) ? 'epub' : 'pdf',
    })
  }
  const pairedOriginals = new Set<string>()
  const files = directory.files
    .filter((file) => allowedPath(file.path) && /\.(?:md|txt|html?|json)$/i.test(file.path))
    .sort((a, b) => a.path.localeCompare(b.path, 'en'))
  if (files.length > 2000) throw new Error('Readwise 导出文件过多，请选择更小的目录。')
  const reader: unknown[] = [],
    books: unknown[] = []
  const exports = new Map<string, { body?: ReadwiseItem; highlights?: ReadwiseItem }>()
  const jsonResources = new Map<string, ReadwiseItem['resources']>()
  for (const [index, file] of files.entries()) {
    context.signal.throwIfAborted()
    if (file.size > 4 * 1024 * 1024) throw new Error(`导出文件超过 4 MiB：${file.path}`)
    const blob = await directory.read(file.path)
    context.signal.throwIfAborted()
    if (blob.size > 4 * 1024 * 1024) throw new Error(`导出文件超过 4 MiB：${file.path}`)
    charge(blob.size)
    const raw = new TextDecoder('utf-8', { fatal: true })
      .decode(await blob.arrayBuffer())
      .replaceAll('\r\n', '\n')
    if (/\.json$/i.test(file.path)) {
      let parsed: unknown
      try {
        parsed = JSON.parse(raw)
      } catch {
        throw new Error(`JSON 导出无法解析：${file.path}`)
      }
      const list = Array.isArray(parsed) ? parsed : record(parsed).results
      if (!Array.isArray(list)) continue
      for (const entry of list) {
        const references = resourcesFor(file.path)
        const convert = (value: unknown) => {
          const item = { ...record(value) }
          const html = string(item.html_content)
          if (html) {
            item.content = htmlToMarkdown(html, references.resolve)
            item.html_content = ''
          }
          if (typeof item.content === 'string') item.content = references.markdown(item.content)
          if (typeof item.text === 'string') item.text = references.markdown(item.text)
          return item
        }
        const item = convert(entry)
        let key: string
        if (item.user_book_id !== undefined && Array.isArray(item.highlights)) {
          key =
            item.source === 'reader' && item.external_id
              ? `reader:${identity(item.external_id)}`
              : `book:${identity(item.user_book_id)}`
          item.highlights = item.highlights.map(convert)
          books.push(item)
        } else if (
          item.id !== undefined &&
          ('html_content' in item || 'parent_id' in item || 'category' in item)
        ) {
          key = `reader:${identity(item.parent_id || item.id)}`
          reader.push(item)
        } else continue
        jsonResources.set(key, mergeResources(jsonResources.get(key), await references.load()))
      }
    } else {
      const references = resourcesFor(file.path)
      const text = /\.html?$/i.test(file.path)
        ? htmlToMarkdown(raw, references.resolve)
        : references.markdown(raw)
      if (text.length > 250_000) throw new Error(`导出材料超过 250,000 字符：${file.path}`)
      const data = metadata(text)
      // Readwise's standard export pairs Books/X.md with Full Document Contents/Books/X.md.
      const relative = relativeKey(file.path)
      const key = knownKey(data, text) || `export:${relative}`
      const title =
        string(data.title) ||
        /^#\s+(.+)$/m.exec(text)?.[1] ||
        file.path
          .split('/')
          .at(-1)!
          .replace(/\.[^.]+$/, '')
      const item: ReadwiseItem = {
        key,
        title: title.slice(0, 160),
        text,
        format: 'markdown',
        path: file.path,
        url: safeUrl(data.source_url) ?? safeUrl(data.url),
        original: originals.get(relative),
        resources: await references.load(),
      }
      if (item.original) pairedOriginals.add(relative)
      const kind =
        /(^|\/)Full Document Contents\//i.test(file.path) ||
        /^##\s+(?:Full Document|全文|正文)\s*$/m.test(text)
          ? 'body'
          : 'highlights'
      const previous = exports.get(key) ?? {}
      if (previous[kind]) throw new Error(`多个导出文件使用同一来源标识：${file.path}`)
      previous[kind] = item
      exports.set(key, previous)
    }
    context.progress({ completed: index + 1, total: files.length, message: file.path })
    await context.yield()
  }
  const snapshot = convertReadwise(reader, books)
  for (const item of snapshot.items) item.resources = jsonResources.get(item.key) ?? []
  const items = new Map(snapshot.items.map((item) => [item.key, item]))
  for (const [key, group] of exports) {
    if (items.has(key))
      throw new Error(`JSON 与文本导出包含重复来源：${key}。请选择其中一种导出格式。`)
    const item = group.body ?? group.highlights!
    if (group.body && group.highlights) {
      item.text += `\n\n## 导出高亮\n\n${group.highlights.text}`
      item.resources = mergeResources(group.body.resources, group.highlights.resources)
    }
    if (item.text.length > 250_000) throw new Error(`导出材料超过 250,000 字符：${item.title}`)
    items.set(key, item)
  }
  for (const [relative, original] of originals) {
    if (pairedOriginals.has(relative)) continue
    const key = `export:${relative}`
    items.set(key, {
      key,
      title: relative.split('/').at(-1)!,
      text: '此导出仅提供原件。获取原件后可通过文档阅读器导入阅读。',
      format: 'markdown',
      original,
    })
  }
  if (items.size > 1000) throw new Error('Readwise 来源超过 1,000 篇，请选择更小的目录。')
  context.signal.throwIfAborted()
  return {
    ...snapshot,
    items: [...items.values()].sort((a, b) => a.key.localeCompare(b.key, 'en')),
  }
}
