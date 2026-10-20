import { z } from 'zod'

export const MAX_SOURCE_BYTES = 1024 * 1024
export const MAX_SOURCE_CHARACTERS = 250_000
export const MAX_EXCERPT_CHARACTERS = 10_000
const id = z.string().min(1).max(100)
export const sourceSchema = z.object({
  id,
  title: z.string().trim().min(1).max(160),
  url: z
    .string()
    .trim()
    .max(2048)
    .regex(/^(?:https?:\/\/[^\s]+)?$/)
    .default(''),
  format: z.enum(['plain', 'markdown']),
  mediaId: id,
  characters: z.number().int().min(1).max(MAX_SOURCE_CHARACTERS),
  createdAt: z.iso.datetime(),
})
/** UTF-16 offsets refer to one immutable snapshot, not the external document. */
export const excerptSchema = z
  .object({
    sourceId: id,
    start: z.number().int().min(0).max(MAX_SOURCE_CHARACTERS),
    end: z.number().int().positive().max(MAX_SOURCE_CHARACTERS),
    quote: z.string().min(1).max(MAX_EXCERPT_CHARACTERS),
  })
  .refine(
    (excerpt) =>
      excerpt.end - excerpt.start === excerpt.quote.length &&
      excerpt.quote.length <= MAX_EXCERPT_CHARACTERS &&
      !!excerpt.quote.trim(),
  )
export type Source = z.infer<typeof sourceSchema>
export type SourceExcerpt = z.infer<typeof excerptSchema>
export interface SourceInput {
  title: string
  url: string
  format: Source['format']
  content: string
}
