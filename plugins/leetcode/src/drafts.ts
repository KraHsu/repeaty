import { pluginData } from '@repeaty/plugin-api'
import { z } from 'zod'
const draftSchema = z.object({
  practiceId: z.string().optional(),
  attemptId: z.string().optional(),
  revision: z.string(),
  lang: z.string(),
  code: z.record(z.string(), z.string().max(50000)),
  attempts: z.number().int().nonnegative(),
  elapsedMs: z.number().finite().nonnegative(),
  answerSeen: z.boolean(),
  awaitingSubmit: z.boolean().default(false),
  uncertain: z.boolean().default(false),
  mode: z.enum(['manual', 'automatic']),
  pending: z
    .string()
    .regex(/^\d{1,30}$/)
    .optional(),
  submissionId: z
    .string()
    .regex(/^\d{1,30}$/)
    .optional(),
  result: z
    .object({
      outcome: z.enum(['accepted', 'rejected']),
      status: z.string(),
      runtime: z.string(),
      memory: z.string(),
      detail: z.string(),
    })
    .optional(),
})
export type Draft = z.infer<typeof draftSchema>
export async function readDraft(
  id: string,
  revision: string,
  scope = 'local:repeaty',
): Promise<Draft | undefined> {
  const value = draftSchema.safeParse(await pluginData.get(id, scope))
  return value.success && value.data.revision === revision ? value.data : undefined
}
export async function writeDraft(id: string, draft?: Draft, scope = 'local:repeaty') {
  return pluginData.set(id, draft ? draftSchema.parse(draft) : undefined, scope)
}
