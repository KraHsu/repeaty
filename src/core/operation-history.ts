import { z } from 'zod'
import { recordSchemas } from './model'
import { attemptSchema, attemptSummarySchema } from './practice-data'
import type { Operation, Store } from './operations'

export const MAX_OPERATION_HISTORY = 20
export interface OperationHistory {
  schemaVersion: 1
  undo: Operation[]
  redo: Operation[]
  mediaIds: string[]
}
const changeSchema = z
  .object({
    store: z.enum(Object.keys(recordSchemas) as [Store, ...Store[]]),
    id: z.string().min(1).max(200),
    index: z.number().int().nonnegative(),
    before: z.unknown().optional(),
    after: z.unknown().optional(),
    keys: z.array(z.string().min(1).max(100)).max(100),
  })
  .superRefine((change, context) => {
    if (
      change.store === 'materialReceipts' ||
      (!change.before && !change.after) ||
      new Set(change.keys).size !== change.keys.length ||
      change.keys.some((key) => ['__proto__', 'constructor', 'prototype'].includes(key))
    ) {
      context.addIssue({ code: 'custom', message: 'Invalid operation change' })
      return
    }
    const schema =
      change.store === 'attempts'
        ? z.union([attemptSchema, attemptSummarySchema])
        : recordSchemas[change.store]
    for (const value of [change.before, change.after]) {
      if (value === undefined) continue
      const result = schema.safeParse(value)
      if (!result.success || result.data.id !== change.id)
        context.addIssue({ code: 'custom', message: 'Invalid operation record' })
    }
  })
const operationSchema = z
  .object({
    id: z.string().min(1).max(200),
    createdAt: z.iso.datetime(),
    scope: z.string().max(2000),
    label: z.string().min(1).max(200),
    kind: z.enum(['change', 'reading', 'review']),
    changes: z.array(changeSchema).min(1).max(1_000_000),
    cardId: z.string().max(200).optional(),
    noteIds: z.array(z.string().max(200)).max(100_000),
    reviewId: z.string().max(200).optional(),
  })
  .superRefine((operation, context) => {
    if (
      new Set(operation.changes.map((change) => `${change.store}:${change.id}`)).size !==
      operation.changes.length
    )
      context.addIssue({ code: 'custom', message: 'Duplicate operation record' })
  })
const historySchema = z.object({
  schemaVersion: z.literal(1),
  undo: z.array(operationSchema).max(MAX_OPERATION_HISTORY),
  redo: z.array(operationSchema).max(MAX_OPERATION_HISTORY),
  mediaIds: z.array(z.string().min(1).max(200)).max(100_000),
})

/** References keep immutable originals alive independently of checkpoint retention. */
export function operationHistory(undo: Operation[] = [], redo: Operation[] = []): OperationHistory {
  const mediaIds = new Set<string>()
  for (const entry of [...undo, ...redo])
    for (const change of entry.changes) {
      if (change.store === 'media') mediaIds.add(change.id)
      for (const value of [change.before, change.after]) {
        if (!value) continue
        if (change.store === 'sources') {
          const source = value as import('./source-data').Source
          for (const version of [source, ...(source.versions ?? [])]) {
            mediaIds.add(version.mediaId)
            if (version.document) mediaIds.add(version.document.originalMediaId)
            for (const ref of version.inlineMedia ?? []) mediaIds.add(ref.mediaId)
          }
        } else if (change.store === 'notes') {
          const note = value as import('./model').Note
          for (const id of [...(note.frontMedia ?? []), ...(note.backMedia ?? [])]) mediaIds.add(id)
          for (const ref of note.inlineMedia ?? []) mediaIds.add(ref.mediaId)
        }
      }
    }
  return { schemaVersion: 1, undo, redo, mediaIds: [...mediaIds].sort() }
}

export function parseOperationHistory(value: unknown): OperationHistory {
  const parsed = historySchema.parse(value) as OperationHistory
  const normalized = operationHistory(parsed.undo, parsed.redo)
  if (JSON.stringify([...new Set(parsed.mediaIds)].sort()) !== JSON.stringify(normalized.mediaIds))
    throw new Error('Invalid operation media references')
  const ids = [...parsed.undo, ...parsed.redo].map((entry) => entry.id)
  if (new Set(ids).size !== ids.length) throw new Error('Duplicate operation identity')
  return normalized
}

export function rebindOperationHistory(history: OperationHistory, scope: string): OperationHistory {
  return operationHistory(
    history.undo.map((entry) => ({ ...entry, scope })),
    history.redo.map((entry) => ({ ...entry, scope })),
  )
}
