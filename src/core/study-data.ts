import { z } from 'zod'

const id = z.string().min(1).max(150)
const weight = (min: number, max: number) => z.number().finite().min(min).max(max)
// FSRS-6 coordinate bounds, represented in JSON Schema for the native boundary too.
export const fsrsWeightsSchema = z.tuple([
  weight(0.001, 100),
  weight(0.001, 100),
  weight(0.001, 100),
  weight(0.001, 100),
  weight(1, 10),
  weight(0.001, 4),
  weight(0.001, 4),
  weight(0.001, 0.75),
  weight(0, 4.5),
  weight(0, 0.8),
  weight(0.001, 3.5),
  weight(0.001, 5),
  weight(0.001, 0.25),
  weight(0.001, 0.9),
  weight(0, 4),
  weight(0, 1),
  weight(1, 6),
  weight(0, 2),
  weight(0, 2),
  weight(0, 0.8),
  weight(0.1, 0.8),
])
const metrics = z.object({
  logLoss: z.number().finite().nonnegative(),
  rmse: z.number().finite().min(0).max(1),
})
export const fsrsModelSchema = z.object({
  id,
  deckId: id.optional(),
  createdAt: z.iso.datetime(),
  modelVersion: z.literal('FSRS-6'),
  weights: fsrsWeightsSchema,
  baselineWeights: fsrsWeightsSchema,
  baselineModelId: id.optional(),
  baselineSelectionId: id.optional(),
  historyFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  counts: z.object({
    reviews: z.number().int().min(1024).max(500_000),
    cards: z.number().int().positive().max(200_000),
    training: z.number().int().min(512).max(500_000),
    validation: z.number().int().min(128).max(500_000),
    excluded: z.number().int().nonnegative().max(500_000),
  }),
  metrics: z.object({ baseline: metrics, candidate: metrics }),
  engine: z.string().min(1).max(160),
})
export const studyEventSchema = z.object({
  id,
  kind: z.enum(['reading', 'practice']),
  occurredAt: z.iso.datetime(),
  studyDay: z.iso.date(),
  sourceId: id.optional(),
  cardId: id.optional(),
})
export const studyActivitySchema = z
  .object({
    id,
    kind: z.enum(['reading', 'review', 'practice', 'other']),
    studyDay: z.iso.date(),
    startedAt: z.iso.datetime(),
    endedAt: z.iso.datetime(),
    activeMs: z
      .number()
      .int()
      .nonnegative()
      .max(26 * 60 * 60 * 1000),
  })
  .refine(
    (value) =>
      Date.parse(value.endedAt) >= Date.parse(value.startedAt) &&
      value.activeMs <= Date.parse(value.endedAt) - Date.parse(value.startedAt),
  )
export type StudyEvent = z.infer<typeof studyEventSchema>
export type StudyActivity = z.infer<typeof studyActivitySchema>
export type FsrsModel = z.infer<typeof fsrsModelSchema>
