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
