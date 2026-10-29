import { z } from 'zod'
import { inlineMediaSchema } from './inline-media-data'
import { parseSourceProperties, MAX_SOURCE_PROPERTIES } from './source-properties'
import {
  materialDocumentSchema,
  materialLocatorSchema,
  locatorMatchesReference,
  materialLocatorMatches,
} from './material-data'

export const MAX_SOURCE_BYTES = 1024 * 1024
export const MAX_SOURCE_CHARACTERS = 250_000
export const MAX_EXCERPT_CHARACTERS = 10_000
export const MAX_SOURCE_DEPTH = 32
const id = z.string().min(1).max(100)
export function characterBoundary(text: string, offset: number) {
  const position = Math.max(0, Math.min(text.length, Math.trunc(offset)))
  return position > 0 &&
    /[\uDC00-\uDFFF]/.test(text[position] ?? '') &&
    /[\uD800-\uDBFF]/.test(text[position - 1]!)
    ? position - 1
    : position
}
/** Offsets address the immutable snapshot; preview fractions address one rendered block. */
export const readingPositionSchema = z
  .object({
    offset: z.number().int().nonnegative().max(MAX_SOURCE_CHARACTERS),
    fraction: z.number().finite().min(0).max(1),
    view: z.enum(['source', 'preview']),
    locator: materialLocatorSchema.optional(),
  })
  .refine((position) => position.view === 'preview' || position.fraction === 0)
export const sourceReadingSchema = readingPositionSchema.extend({ updatedAt: z.iso.datetime() })
export const sourceQueueSchema = z.object({
  state: z.enum(['active', 'archived']),
  availableOn: z.iso.date(),
})
export const sourcePrioritySchema = z.enum(['high', 'normal', 'low'])
export type SourcePriority = z.infer<typeof sourcePrioritySchema>
export const READING_INTERVAL_DAYS = [1, 3, 7, 14, 30] as const
export const sourceReadingIntervalSchema = z.literal(READING_INTERVAL_DAYS)
export const readingFeedbackSchema = z.enum(['again', 'good', 'easy'])
export type ReadingFeedback = z.infer<typeof readingFeedbackSchema>
export const adaptiveIntervalSchema = z.number().int().min(1).max(365)
export const adaptiveReadingSchema = z.object({
  intervalDays: adaptiveIntervalSchema,
  factor: z.number().finite().min(1.3).max(3),
  lastReadOn: z.iso.date(),
  readCount: z.number().int().min(1).max(1_000_000),
  feedback: readingFeedbackSchema,
})
export const sourceQueueActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('defer'), date: z.iso.date() }),
  z.object({
    type: z.literal('read'),
    intervalDays: sourceReadingIntervalSchema,
    date: z.iso.date(),
  }),
  z.object({
    type: z.literal('read-adaptive'),
    feedback: readingFeedbackSchema,
    intervalDays: adaptiveIntervalSchema,
    date: z.iso.date(),
    expectedReadCount: z.number().int().min(0).max(999_999),
  }),
  z.object({ type: z.literal('reset-interval') }),
  z.object({ type: z.literal('archive') }),
  z.object({ type: z.literal('restore') }),
  z.object({ type: z.literal('priority'), priority: sourcePrioritySchema }),
])
export type SourceQueueAction = z.infer<typeof sourceQueueActionSchema>
export interface SourceQueueUpdate {
  sourceId: string
  mediaId: string
  scope: string
  action: SourceQueueAction
  position?: ReadingPosition
}
export type SourceBatchAction = Extract<
  SourceQueueAction,
  { type: 'priority' | 'defer' | 'archive' | 'restore' }
>
export interface SourceArrangement {
  queue?: Source['queue']
  priority?: SourcePriority
  readingIntervalDays?: Source['readingIntervalDays']
  adaptiveReading?: Source['adaptiveReading']
}
export interface SourceTarget {
  id: string
  mediaId: string
  before: SourceArrangement
}
export interface SourceBatchUpdate {
  targets: SourceTarget[]
  action: SourceBatchAction
  scope: string
  reading?: ReadingUpdate
}
export const sourceOriginSchema = z
  .object({
    sourceId: id,
    mediaId: id.optional(),
    start: z.number().int().min(0).max(MAX_SOURCE_CHARACTERS),
    end: z.number().int().positive().max(MAX_SOURCE_CHARACTERS),
    locator: materialLocatorSchema.optional(),
  })
  .refine(
    (origin) =>
      origin.end > origin.start &&
      origin.end - origin.start <= MAX_EXCERPT_CHARACTERS &&
      (!origin.locator || locatorMatchesReference(origin, origin.locator)),
  )
export type SourceOrigin = z.infer<typeof sourceOriginSchema>
export const sourceDetailsSchema = z.strictObject({
  title: z.string().trim().min(1).max(160),
  url: z
    .string()
    .trim()
    .max(2048)
    .regex(/^(?:https?:\/\/[^\s]+)?$/)
    .default(''),
})
export type SourceDetails = z.infer<typeof sourceDetailsSchema>
export const sourcePropertiesSchema = z
  .string()
  .max(MAX_SOURCE_PROPERTIES)
  .superRefine((value, ctx) => {
    try {
      parseSourceProperties(value)
    } catch (error) {
      ctx.addIssue({ code: 'custom', message: (error as Error).message })
    }
  })
export const sourceAnnotationSchema = z
  .object({
    id: z.uuid(),
    mediaId: id,
    start: z.number().int().nonnegative().max(MAX_SOURCE_CHARACTERS),
    end: z.number().int().positive().max(MAX_SOURCE_CHARACTERS),
    quote: z.string().min(1).max(MAX_EXCERPT_CHARACTERS),
    body: z.string().trim().min(1).max(10_000),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .refine((value) => value.end - value.start === value.quote.length)
export type SourceAnnotation = z.infer<typeof sourceAnnotationSchema>
export const sourceVersionSchema = z.object({
  ...sourceDetailsSchema.shape,
  mediaId: id,
  format: z.enum(['plain', 'markdown']),
  characters: z.number().int().min(1).max(MAX_SOURCE_CHARACTERS),
  acceptedAt: z.iso.datetime(),
  inlineMedia: inlineMediaSchema.optional(),
  reading: sourceReadingSchema.optional(),
  derived: z.literal(true).optional(),
  document: materialDocumentSchema.optional(),
  properties: sourcePropertiesSchema.optional(),
})
export type SourceVersion = z.infer<typeof sourceVersionSchema>
export interface SourceDetailsUpdate {
  sourceId: string
  mediaId: string
  scope: string
  before: SourceDetails
  details: SourceDetails
  position?: ReadingPosition
}
export const sourceSchema = z
  .object({
    id,
    parentSourceId: id.optional(),
    folderId: id.optional(),
    order: z.number().finite().optional(),
    properties: sourcePropertiesSchema.optional(),
    annotations: z.array(sourceAnnotationSchema).max(1000).optional(),
    ...sourceDetailsSchema.shape,
    format: z.enum(['plain', 'markdown']),
    mediaId: id,
    characters: z.number().int().min(1).max(MAX_SOURCE_CHARACTERS),
    createdAt: z.iso.datetime(),
    reading: sourceReadingSchema.optional(),
    queue: sourceQueueSchema.optional(),
    priority: sourcePrioritySchema.optional(),
    readingIntervalDays: sourceReadingIntervalSchema.optional(),
    adaptiveReading: adaptiveReadingSchema.optional(),
    inlineMedia: inlineMediaSchema.optional(),
    versions: z.array(sourceVersionSchema).max(1000).optional(),
    acceptedAt: z.iso.datetime().optional(),
    derived: z.literal(true).optional(),
    document: materialDocumentSchema.optional(),
    kind: z.literal('excerpt').optional(),
    origin: sourceOriginSchema.optional(),
  })
  .superRefine((source, context) => {
    for (const snapshot of [source, ...(source.versions ?? [])])
      if (
        snapshot.reading?.locator &&
        !materialLocatorMatches({ ...snapshot, id: source.id }, snapshot.reading.locator)
      )
        context.addIssue({ code: 'custom', message: '阅读定位与材料版本不匹配。' })
    if (source.parentSourceId === source.id)
      context.addIssue({ code: 'custom', message: '材料不能作为自己的父级。' })
    if (
      source.reading &&
      (source.reading.offset > source.characters ||
        (source.format !== 'markdown' && source.reading.view === 'preview'))
    )
      context.addIssue({ code: 'custom', message: '阅读位置与材料不匹配。' })
    if (
      (source.kind === 'excerpt' && source.characters > MAX_EXCERPT_CHARACTERS) ||
      (source.origin &&
        (source.kind !== 'excerpt' ||
          source.origin.sourceId === source.id ||
          (!source.derived && source.origin.end - source.origin.start !== source.characters)))
    )
      context.addIssue({ code: 'custom', message: '摘录与来源不匹配。' })
    const ids = [source.mediaId, ...(source.versions ?? []).map((version) => version.mediaId)]
    if (new Set(ids).size !== ids.length)
      context.addIssue({ code: 'custom', message: '材料版本重复。' })
    if (
      new Set(source.annotations?.map((entry) => entry.id)).size !==
      (source.annotations?.length ?? 0)
    )
      context.addIssue({ code: 'custom', message: '批注标识重复。' })
    for (const entry of source.annotations ?? []) {
      const version = [source, ...(source.versions ?? [])].find(
        (item) => item.mediaId === entry.mediaId,
      )
      if (!version || entry.end > version.characters)
        context.addIssue({ code: 'custom', message: '批注与材料版本不匹配。' })
    }
    for (const version of source.versions ?? [])
      if (
        version.reading &&
        (version.reading.offset > version.characters ||
          (version.format !== 'markdown' && version.reading.view === 'preview'))
      )
        context.addIssue({ code: 'custom', message: '阅读位置与材料不匹配。' })
  })
export type ReadingPosition = z.infer<typeof readingPositionSchema>
export interface ReadingUpdate {
  sourceId: string
  mediaId: string
  scope: string
  position: ReadingPosition
}
/** UTF-16 offsets refer to one immutable snapshot, not the external document. */
export const excerptSchema = z
  .object({
    sourceId: id,
    mediaId: id.optional(),
    start: z.number().int().min(0).max(MAX_SOURCE_CHARACTERS),
    end: z.number().int().positive().max(MAX_SOURCE_CHARACTERS),
    quote: z.string().min(1).max(MAX_EXCERPT_CHARACTERS),
    locator: materialLocatorSchema.optional(),
  })
  .refine(
    (excerpt) =>
      excerpt.end - excerpt.start === excerpt.quote.length &&
      excerpt.quote.length <= MAX_EXCERPT_CHARACTERS &&
      !!excerpt.quote.trim() &&
      (!excerpt.locator || locatorMatchesReference(excerpt, excerpt.locator)),
  )
export type Source = z.infer<typeof sourceSchema>
/** Unversioned references address the first snapshot, including retired notes and drafts. */
export function referencedSource(
  source: Source,
  reference: { mediaId?: string },
): Source | undefined {
  return sourceAtVersion(
    source,
    reference.mediaId ?? source.versions?.[0]?.mediaId ?? source.mediaId,
  )
}
export function sourceAtVersion(source: Source, mediaId = source.mediaId): Source | undefined {
  if (mediaId === source.mediaId) return source
  const version = source.versions?.find((version) => version.mediaId === mediaId)
  return version
    ? {
        ...source,
        ...version,
        reading: version.reading,
        inlineMedia: version.inlineMedia,
        derived: version.derived,
        document: version.document,
        properties: version.properties,
        versions: undefined,
      }
    : undefined
}
export type SourceExcerpt = z.infer<typeof excerptSchema>
export interface SourceInput {
  title: string
  url: string
  format: Source['format']
  content: string
}
export interface SaveSourceExcerptInput {
  excerpt: SourceExcerpt
  title: string
  mediaId: string
  scope: string
  position?: ReadingPosition
}
