import { LocalizedError, msg } from '../i18n'
import { mediaSchema, pruneMedia, type Library, type MediaUpload } from './model'
import {
  sourceSchema,
  excerptSchema,
  MAX_SOURCE_BYTES,
  MAX_SOURCE_CHARACTERS,
  type Source,
  type SourceInput,
  type SourceExcerpt,
  type ReadingPosition,
} from './source-data'

const invalid = () => new LocalizedError(msg('原文快照缺失或损坏，请从备份恢复。'))
export function prepareSource(
  input: SourceInput,
  now = new Date(),
): { source: Source; asset: MediaUpload } {
  // Textarea selections use LF and UTF-16 offsets on every platform.
  const content = input.content.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  if (!content.trim() || content.length > MAX_SOURCE_CHARACTERS)
    throw new LocalizedError(msg('正文不能为空，且不能超过 250000 个字符。'))
  const blob = new Blob([content], {
    type: input.format === 'markdown' ? 'text/markdown' : 'text/plain',
  })
  if (blob.size > MAX_SOURCE_BYTES)
    throw new LocalizedError(msg('文本或 Markdown 文件不能超过 1 MB。'))
  const timestamp = now.toISOString(),
    mediaId = crypto.randomUUID()
  const source = sourceSchema.parse({
    ...input,
    id: crypto.randomUUID(),
    mediaId,
    characters: content.length,
    createdAt: timestamp,
  })
  const meta = mediaSchema.parse({
    id: mediaId,
    name: `${source.title.replace(/[\\/]/g, '_')}.${source.format === 'markdown' ? 'md' : 'txt'}`,
    type: blob.type,
    size: blob.size,
    createdAt: timestamp,
  })
  return { source, asset: { meta, blob } }
}
export async function readSource(
  source: Source,
  library: Library,
  getMedia: (id: string) => Promise<Blob | undefined>,
  signal?: AbortSignal,
): Promise<string> {
  signal?.throwIfAborted()
  const meta = library.media.find((entry) => entry.id === source.mediaId)
  if (!meta || meta.size > MAX_SOURCE_BYTES) throw invalid()
  const blob = await getMedia(source.mediaId)
  signal?.throwIfAborted()
  if (
    !blob ||
    blob.type !== meta.type ||
    blob.size !== meta.size ||
    blob.type !== (source.format === 'markdown' ? 'text/markdown' : 'text/plain')
  )
    throw invalid()
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
      await blob.arrayBuffer(),
    )
  } catch {
    throw invalid()
  }
  signal?.throwIfAborted()
  if (text.length !== source.characters || !text.trim() || text.includes('\r')) throw invalid()
  return text
}
export function sourceExcerpt(
  source: Source,
  text: string,
  start: number,
  end: number,
): SourceExcerpt {
  if (text.length !== source.characters) throw invalid()
  const excerpt = excerptSchema.safeParse({
    sourceId: source.id,
    start,
    end,
    quote: text.slice(start, end),
  })
  if (!excerpt.success || !excerpt.data.quote.trim())
    throw new LocalizedError(msg('请选取 1–10000 个字符作为摘录。'))
  // Do not split UTF-16 surrogate pairs at a selection boundary.
  if (/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/.test(excerpt.data.quote))
    throw new LocalizedError(msg('请完整选中摘录中的字符。'))
  return excerpt.data
}
export function addSource(library: Library, source: Source, asset: MediaUpload): Library {
  if (
    library.sources.some((entry) => entry.id === source.id) ||
    library.media.some((entry) => entry.id === asset.meta.id) ||
    source.mediaId !== asset.meta.id
  )
    throw invalid()
  return {
    ...library,
    sources: [...library.sources, source],
    media: [...library.media, asset.meta],
  }
}
export function removeSource(library: Library, id: string): Library {
  if (!library.sources.some((source) => source.id === id))
    throw new LocalizedError(msg('材料已不存在，请刷新后重试。'))
  return pruneMedia({
    ...library,
    sources: library.sources.filter((source) => source.id !== id),
    notes: library.notes.map((note) =>
      note.excerpt?.sourceId === id ? { ...note, excerpt: undefined } : note,
    ),
  })
}

export function sameReadingPosition(a: ReadingPosition | undefined, b: ReadingPosition) {
  return a?.offset === b.offset && a.view === b.view && a.fraction === b.fraction
}
export function saveReadingPosition(
  library: Library,
  id: string,
  mediaId: string,
  position: ReadingPosition,
  now = new Date(),
): Library {
  const source = library.sources.find((source) => source.id === id)
  if (!source || source.mediaId !== mediaId)
    throw new LocalizedError(msg('材料已变化，请重新打开后继续阅读。'))
  const next = sourceSchema.parse({
    ...source,
    reading: { ...position, updatedAt: now.toISOString() },
  })
  if (
    sameReadingPosition(source.reading, next.reading!) &&
    source.reading?.updatedAt === next.reading!.updatedAt
  )
    return library
  return { ...library, sources: library.sources.map((entry) => (entry.id === id ? next : entry)) }
}

export function recentSource(sources: Source[]) {
  return (
    sources
      .filter((source) => source.reading)
      .sort((a, b) => b.reading!.updatedAt.localeCompare(a.reading!.updatedAt))[0] ?? sources.at(-1)
  )
}
