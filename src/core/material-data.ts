import { z } from 'zod'
import type { Source } from './source-data'

const id = z.string().min(1).max(100)
const contributor = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,79}$/)
export const materialPathSchema = z
  .string()
  .min(1)
  .max(2048)
  .refine(
    (value) =>
      !/[\\\u0000-\u001f]/.test(value) &&
      !value.startsWith('/') &&
      !value.includes(':') &&
      value.split('/').every((part) => !!part && part !== '.' && part !== '..'),
  )
export const materialMetadataSchema = z
  .record(z.string().max(100), z.json())
  .refine((value) => new TextEncoder().encode(JSON.stringify(value)).length <= 16 * 1024)
/** The text projection remains readable without the independently installed reader. */
export const materialDocumentSchema = z.strictObject({
  schemaVersion: z.literal(1),
  providerId: contributor,
  readerId: contributor.optional(),
  format: z.string().regex(/^[a-z0-9][a-z0-9.+_-]{0,63}$/),
  originalMediaId: id,
  path: materialPathSchema.optional(),
  data: materialMetadataSchema.optional(),
  container: z.boolean().optional(),
  resources: z
    .array(z.strictObject({ path: materialPathSchema, mediaId: id }))
    .max(2000)
    .refine((entries) => new Set(entries.map((entry) => entry.path)).size === entries.length)
    .optional(),
  importKey: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
})
export type MaterialDocument = z.infer<typeof materialDocumentSchema>

const fraction = z.number().finite().min(0).max(1)
const rectangle = z
  .strictObject({
    x: fraction,
    y: fraction,
    width: z.number().finite().positive().max(1),
    height: z.number().finite().positive().max(1),
  })
  .refine((region) => region.x + region.width <= 1 && region.y + region.height <= 1)
const binding = { schemaVersion: z.literal(1), sourceId: id, versionId: id }
/** Coordinates address the immutable original associated with one projection version. */
export const materialLocatorSchema = z.discriminatedUnion('kind', [
  z
    .strictObject({
      ...binding,
      kind: z.literal('text'),
      start: z.number().int().nonnegative().max(250_000),
      end: z.number().int().positive().max(250_000),
      quote: z.string().min(1).max(10_000),
    })
    .refine(
      (value) =>
        value.end - value.start === value.quote.length &&
        !!value.quote.trim() &&
        !/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/.test(value.quote),
    ),
  z.strictObject({
    ...binding,
    kind: z.literal('pdf'),
    regions: z
      .array(rectangle.safeExtend({ page: z.number().int().nonnegative().max(1_000_000) }))
      .min(1)
      .max(256),
  }),
  z
    .strictObject({
      ...binding,
      kind: z.literal('epub'),
      href: z
        .string()
        .min(1)
        .max(2048)
        .refine(
          (value) =>
            !/^[\\/]/.test(value) &&
            !value.split('/')[0]!.includes(':') &&
            !value.split(/[\\/]/).includes('..'),
        ),
      cfi: z.string().min(1).max(4096).optional(),
      start: z.number().int().nonnegative().max(250_000).optional(),
      end: z.number().int().positive().max(250_000).optional(),
    })
    .refine(
      (value) =>
        (value.start === undefined && value.end === undefined) ||
        (value.start !== undefined && value.end !== undefined && value.end > value.start),
    ),
  rectangle.safeExtend({ ...binding, kind: z.literal('image') }),
  z
    .strictObject({
      ...binding,
      kind: z.literal('formula'),
      start: z.number().int().nonnegative().max(250_000),
      end: z.number().int().positive().max(250_000),
      latex: z.string().trim().min(1).max(10_000),
      leaves: z
        .array(z.number().int().nonnegative().max(100_000))
        .min(1)
        .max(1000)
        .refine((values) => new Set(values).size === values.length),
    })
    .refine((value) => value.end > value.start),
])
export type MaterialLocator = z.infer<typeof materialLocatorSchema>
export type SourceLocator = MaterialLocator
export const materialReceiptSchema = z.strictObject({
  id: z.string().min(1).max(150),
  pluginId: contributor,
  operationId: z.string().min(1).max(150),
  kind: z.enum([
    'import',
    'create-note',
    'create-excerpt',
    'edit-content',
    'set-sequence',
    'annotate',
    'remove-annotation',
  ]),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  result: z.strictObject({
    sourceIds: z.array(id).max(1000),
    noteIds: z.array(z.string().min(1).max(150)).max(1000),
    versionId: id.optional(),
    annotationId: z.uuid().optional(),
  }),
  createdAt: z.iso.datetime(),
})
export type MaterialReceipt = z.infer<typeof materialReceiptSchema>

/** A retained version/receipt identity must never acquire a different interpretation. */
export function validateMaterialChanges(
  before: { sources: Source[]; materialReceipts: MaterialReceipt[] },
  next: { sources: Source[]; materialReceipts: MaterialReceipt[] },
) {
  if (before.sources !== next.sources) {
    const previous = new Map(before.sources.map((source) => [source.id, source]))
    for (const source of next.sources) {
      const prior = previous.get(source.id)
      if (!prior || prior === source) continue
      const versions = new Map(
        [prior, ...(prior.versions ?? [])].map((entry) => [entry.mediaId, entry.document]),
      )
      for (const entry of [source, ...(source.versions ?? [])])
        if (
          versions.has(entry.mediaId) &&
          JSON.stringify(
            versions.get(entry.mediaId) &&
              materialDocumentSchema.parse(versions.get(entry.mediaId)),
          ) !== JSON.stringify(entry.document && materialDocumentSchema.parse(entry.document))
        )
          throw new Error('material-version-immutable')
    }
  }
  if (before.materialReceipts !== next.materialReceipts) {
    const receipts = new Map(before.materialReceipts.map((entry) => [entry.id, entry]))
    for (const entry of next.materialReceipts) {
      const prior = receipts.get(entry.id)
      if (
        prior &&
        prior !== entry &&
        JSON.stringify(materialReceiptSchema.parse(prior)) !==
          JSON.stringify(materialReceiptSchema.parse(entry))
      )
        throw new Error('material-receipt-immutable')
    }
  }
}

type Snapshot = {
  id: string
  mediaId: string
  characters: number
  format?: string
  document?: MaterialDocument
}
export function materialLocatorMatches(source: Snapshot, locator: MaterialLocator): boolean {
  const parsed = materialLocatorSchema.safeParse(locator)
  if (!parsed.success || locator.sourceId !== source.id || locator.versionId !== source.mediaId)
    return false
  if (locator.kind === 'text') return locator.end <= source.characters
  if (locator.kind === 'formula')
    return source.format === 'markdown' && locator.end <= source.characters
  if (locator.kind === 'epub' && source.document?.path && locator.href !== source.document.path)
    return false
  return source.document?.format === locator.kind
}
export function validateMaterialLocator(source: Snapshot, value: unknown): MaterialLocator {
  const locator = materialLocatorSchema.parse(value)
  if (!materialLocatorMatches(source, locator)) throw new Error('material-locator-version-mismatch')
  return locator
}

export function locatorMatchesReference(
  reference: { sourceId: string; mediaId?: string; start: number; end: number; quote?: string },
  locator: MaterialLocator,
) {
  return (
    reference.sourceId === locator.sourceId &&
    reference.mediaId === locator.versionId &&
    (locator.kind !== 'formula' ||
      (locator.start === reference.start &&
        locator.end === reference.end &&
        (reference.quote === undefined || formulaQuoteMatches(reference.quote, locator.latex)))) &&
    (locator.kind !== 'text' ||
      (locator.start === reference.start &&
        locator.end === reference.end &&
        (reference.quote === undefined || locator.quote === reference.quote)))
  )
}
export function formulaQuoteMatches(quote: string, latex: string) {
  const delimiters = [
    ['$$', '$$'],
    ['\\[', '\\]'],
    ['\\(', '\\)'],
    ['$', '$'],
  ]
  return delimiters.some(
    ([open, close]) =>
      quote.startsWith(open!) &&
      quote.endsWith(close!) &&
      quote.length > open!.length + close!.length &&
      quote.slice(open!.length, -close!.length).trim() === latex.trim(),
  )
}
