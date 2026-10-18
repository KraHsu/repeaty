import { openDB, type DBSchema } from 'idb'
import { z } from 'zod'
const draftSchema = z.object({
  revision: z.string(),
  lang: z.string(),
  code: z.record(z.string(), z.string().max(50000)),
  attempts: z.number().int().nonnegative(),
  elapsedMs: z.number().finite().nonnegative(),
  answerSeen: z.boolean(),
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
interface DraftDB extends DBSchema {
  drafts: { key: string; value: Draft }
}
function database() {
  return openDB<DraftDB>('repeaty-leetcode-drafts', 1, {
    upgrade(db) {
      db.createObjectStore('drafts')
    },
  })
}
export async function readDraft(id: string, revision: string): Promise<Draft | undefined> {
  const db = await database()
  try {
    const value = draftSchema.safeParse(await db.get('drafts', id))
    return value.success && value.data.revision === revision ? value.data : undefined
  } finally {
    db.close()
  }
}
export async function writeDraft(id: string, draft?: Draft) {
  const db = await database()
  try {
    if (draft) await db.put('drafts', draftSchema.parse(draft), id)
    else await db.delete('drafts', id)
  } finally {
    db.close()
  }
}
