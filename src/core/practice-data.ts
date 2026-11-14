import { z } from 'zod'
import { assessmentSchema, pluginDataSchema } from '../plugins/data'

const id = z.string().min(1).max(100)
const date = z.iso.datetime()
export const gradeSchema = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)])
export const judgeResultSchema = z.object({
  outcome: z.enum(['accepted', 'rejected']),
  status: z.string().max(200),
  runtime: z.string().max(200),
  memory: z.string().max(200),
  detail: z.string().max(10_000),
})
export const practiceSchema = z.object({
  id,
  cardId: z.string().min(1).max(150),
  contentRevision: z.string().min(1).max(100),
  question: z.object({
    front: z.string().max(10_000),
    back: z.string().max(10_000),
    format: z.enum(['plain', 'markdown']),
    plugin: pluginDataSchema,
  }),
  startedAt: date,
  answerSeen: z.boolean().optional(),
  completedAt: date.optional(),
  studyDay: z.iso.date().optional(),
  completion: z.enum(['review', 'practice']).optional(),
  assessment: assessmentSchema.optional(),
  rating: gradeSchema.optional(),
  reviewId: id.optional(),
  ratingUndoneAt: date.optional(),
})
export const attemptSchema = z.object({
  id,
  practiceId: id,
  submittedAt: date,
  updatedAt: date,
  language: z.string().regex(/^[a-z0-9-]{1,40}$/),
  code: z.string().max(50_000),
  elapsedMs: z
    .number()
    .finite()
    .min(0)
    .max(365 * 86400_000),
  status: z.enum(['submitting', 'pending', 'completed', 'unknown', 'failed']),
  submissionId: z
    .string()
    .regex(/^\d{1,30}$/)
    .optional(),
  result: judgeResultSchema.optional(),
})
export type Practice = z.infer<typeof practiceSchema>
export type Attempt = z.infer<typeof attemptSchema>

/** A runtime index entry, never a portable submission or a replacement for its body. */
export const attemptSummarySchema = attemptSchema.omit({ code: true, result: true }).extend({
  code: z.never().optional(),
  result: judgeResultSchema
    .omit({ detail: true })
    .extend({ detail: z.never().optional() })
    .optional(),
})
export type AttemptSummary = z.infer<typeof attemptSummarySchema>
export type AttemptRecord = Attempt | AttemptSummary
export function hasAttemptBody(value: AttemptRecord): value is Attempt {
  return (
    typeof value.code === 'string' && (!value.result || typeof value.result.detail === 'string')
  )
}
export function summarizeAttempt(value: AttemptRecord): AttemptSummary {
  const { code: _code, result, ...summary } = value
  if (!result) return summary
  const { detail: _detail, ...judge } = result
  return { ...summary, result: judge }
}
export function sameAttemptSummary(left: AttemptRecord, right: AttemptRecord) {
  const keys = [
    'id',
    'practiceId',
    'submittedAt',
    'updatedAt',
    'language',
    'elapsedMs',
    'status',
    'submissionId',
  ] as const
  if (!keys.every((key) => left[key] === right[key])) return false
  if (!left.result || !right.result) return left.result === right.result
  const resultKeys = ['outcome', 'status', 'runtime', 'memory'] as const
  return resultKeys.every((key) => left.result![key] === right.result![key])
}
