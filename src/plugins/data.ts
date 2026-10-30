import { z } from 'zod'
import { materialLocatorSchema } from '../core/material-data'

/** Plugin data is portable JSON. Unknown plugins stay intact when importing a backup. */
export const pluginDataSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
    version: z.number().int().positive().max(1000),
    variants: z
      .array(z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/))
      .min(1)
      .max(128)
      .refine((values) => new Set(values).size === values.length)
      .optional(),
    variantLocators: z
      .record(z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/), materialLocatorSchema)
      .optional(),
    data: z
      .record(z.string().max(100), z.json())
      .refine((data) => JSON.stringify(data).length <= 200_000, '插件数据不能超过 200,000 字符。'),
  })
  .refine(
    (value) =>
      !value.variantLocators ||
      Object.keys(value.variantLocators).every((key) => value.variants?.includes(key)),
  )
export type PluginData = z.infer<typeof pluginDataSchema>

export const assessmentSchema = z.object({
  pluginId: z.string().max(64),
  mode: z.enum(['manual', 'automatic']),
  attempts: z.number().int().min(0).max(10000),
  elapsedMs: z
    .number()
    .finite()
    .min(0)
    .max(365 * 86400_000),
  outcome: z.enum(['accepted', 'rejected', 'unanswered']),
  submissionId: z
    .string()
    .regex(/^\d{1,30}$/)
    .optional(),
  suggestedGrade: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).optional(),
  answerSeen: z.boolean().optional(),
  ruleVersion: z.number().int().min(1).max(1000).optional(),
})
export type Assessment = z.infer<typeof assessmentSchema>
