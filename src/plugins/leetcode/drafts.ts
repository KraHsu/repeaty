import { openDB, type DBSchema } from 'idb'
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
export interface DraftStorage {
  read(id: string, scope: string): Promise<unknown>
  write(id: string, value: Draft | undefined, scope: string): Promise<void>
}
let storage: DraftStorage | undefined
export function useDraftStorage(value: DraftStorage) {
  storage = value
}
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
export async function readDraft(
  id: string,
  revision: string,
  scope = 'local:repeaty',
  legacyRevision?: string,
): Promise<Draft | undefined> {
  if (storage) {
    const value = draftSchema.safeParse(await storage.read(id, scope))
    return value.success && value.data.revision === revision ? value.data : undefined
  }
  const db = await database()
  try {
    const key = JSON.stringify([scope, id])
    let raw = await db.get('drafts', key)
    if (!raw && scope === 'local:repeaty') raw = await db.get('drafts', id)
    const value = draftSchema.safeParse(raw)
    return value.success &&
      (value.data.revision === revision ||
        (scope === 'local:repeaty' && value.data.revision === legacyRevision))
      ? { ...value.data, revision }
      : undefined
  } finally {
    db.close()
  }
}
export async function writeDraft(id: string, draft?: Draft, scope = 'local:repeaty') {
  if (storage) return storage.write(id, draft ? draftSchema.parse(draft) : undefined, scope)
  const db = await database()
  try {
    const key = JSON.stringify([scope, id])
    if (draft) await db.put('drafts', draftSchema.parse(draft), key)
    else await db.delete('drafts', key)
    if (scope === 'local:repeaty') await db.delete('drafts', id)
  } finally {
    db.close()
  }
}
