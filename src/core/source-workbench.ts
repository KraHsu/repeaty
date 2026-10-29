import { z } from 'zod'
import {
  sourceSchema,
  sourceAnnotationSchema,
  sourceAtVersion,
  sourcePropertiesSchema,
  MAX_SOURCE_CHARACTERS,
  type SourceAnnotation,
} from './source-data'
import { replaceSourceContent, sourceExcerpt } from './sources'
import type { Library } from './model'

export interface SourceContentUpdate {
  sourceId: string
  mediaId: string
  scope: string
  content: string
  properties?: string
  title?: string
  url?: string
  draftId?: string
  before?: { title: string; url: string }
}
export const sourceDraftSchema = z.object({
  id: z.uuid(),
  sourceId: z.string().min(1).max(100),
  mediaId: z.string().min(1).max(100),
  scope: z.string().min(1).max(512),
  content: z.string().max(MAX_SOURCE_CHARACTERS),
  properties: z.string().max(65_536),
  title: z.string().max(160),
  url: z.string().max(2048),
  baseTitle: z.string().max(160).optional(),
  baseUrl: z.string().max(2048).optional(),
  updatedAt: z.iso.datetime(),
})
export type SourceDraft = z.infer<typeof sourceDraftSchema>
export const sourceChanged = () => new Error('材料已变化，请重新打开后继续编辑。')
export function checkSourceDraftVersion(
  source: Library['sources'][number] | undefined,
  draft: SourceDraft,
) {
  if (!source || !sourceAtVersion(source, draft.mediaId)) throw sourceChanged()
}
export function editSourceContent(library: Library, update: SourceContentUpdate, now = new Date()) {
  const source = library.sources.find((item) => item.id === update.sourceId)
  if (!source || source.mediaId !== update.mediaId) throw sourceChanged()
  if (update.before && (source.title !== update.before.title || source.url !== update.before.url))
    throw sourceChanged()
  const result = replaceSourceContent(
    library,
    source.id,
    {
      content: update.content,
      title: update.title ?? source.title,
      url: update.url ?? source.url,
      format: source.format,
    },
    now,
  )
  const next = sourceSchema.parse({
    ...result.source,
    ...(update.properties !== undefined
      ? { properties: sourcePropertiesSchema.parse(update.properties) }
      : {}),
  })
  return {
    ...result,
    source: next,
    library: {
      ...result.library,
      sources: result.library.sources.map((item) => (item.id === next.id ? next : item)),
    },
  }
}
export interface SourceAnnotationUpdate {
  sourceId: string
  mediaId: string
  scope: string
  id?: string
  start: number
  end: number
  quote: string
  body: string
}
export function upsertSourceAnnotation(
  library: Library,
  update: SourceAnnotationUpdate,
  text: string,
  now = new Date(),
) {
  const source = library.sources.find((item) => item.id === update.sourceId)
  const snapshot = source && sourceAtVersion(source, update.mediaId)
  if (!source || !snapshot) throw sourceChanged()
  if (sourceExcerpt(snapshot, text, update.start, update.end).quote !== update.quote)
    throw sourceChanged()
  const existing = update.id ? source.annotations?.find((item) => item.id === update.id) : undefined
  if (update.id && !existing) throw sourceChanged()
  const annotation: SourceAnnotation = sourceAnnotationSchema.parse({
    id: existing?.id ?? crypto.randomUUID(),
    mediaId: update.mediaId,
    start: update.start,
    end: update.end,
    quote: update.quote,
    body: update.body,
    createdAt: existing?.createdAt ?? now.toISOString(),
    updatedAt: now.toISOString(),
  })
  const annotations = existing
    ? source.annotations!.map((item) => (item.id === existing.id ? annotation : item))
    : [...(source.annotations ?? []), annotation]
  const next = sourceSchema.parse({ ...source, annotations })
  return {
    ...library,
    sources: library.sources.map((item) => (item.id === source.id ? next : item)),
  }
}
export function removeSourceAnnotation(library: Library, sourceId: string, id: string) {
  const source = library.sources.find((item) => item.id === sourceId)
  if (!source?.annotations?.some((item) => item.id === id)) throw sourceChanged()
  return {
    ...library,
    sources: library.sources.map((item) =>
      item.id === sourceId
        ? {
            ...source,
            annotations: source.annotations!.filter((item) => item.id !== id),
          }
        : item,
    ),
  }
}
