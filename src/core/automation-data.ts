import { z } from 'zod'

export const MAX_AUTOMATION_RECEIPTS = 100_000
const id = z.string().min(1).max(150)
export const automationIdsSchema = z.strictObject({
  sources: z.array(id).max(100_000),
  folders: z.array(id).max(100_000),
  notes: z.array(id).max(100_000),
  decks: z.array(id).max(100_000),
  cards: z.array(id).max(300_000),
})
export const automationResultSchema = z.strictObject({
  revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  resultIds: automationIdsSchema,
})
/** This record is committed with the mutation and is never removed by undo. */
export const automationReceiptSchema = z.strictObject({
  id,
  actorId: z.string().min(1).max(200),
  /** Caller request.operationId; independent of the host's undo-operation identity. */
  requestId: z.string().regex(/^[a-zA-Z0-9._-]{1,100}$/),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  operationId: id,
  result: automationResultSchema,
  createdAt: z.iso.datetime(),
})
export type AutomationReceipt = z.infer<typeof automationReceiptSchema>
export type AutomationResult = z.infer<typeof automationResultSchema>
export type AutomationIds = z.infer<typeof automationIdsSchema>

/** Storage adapters may add receipts, but may not rewrite an acknowledged result. */
export function validateAutomationReceipts(
  previous: readonly AutomationReceipt[],
  next: readonly AutomationReceipt[],
  fail: (message: string) => void,
) {
  if (next.length > MAX_AUTOMATION_RECEIPTS) fail('Automation receipt limit exceeded.')
  const ids = new Set<string>(),
    requests = new Set<string>()
  const old = new Map(previous.map((entry) => [entry.id, entry]))
  for (const entry of next) {
    const request = JSON.stringify([entry.actorId, entry.requestId])
    if (ids.has(entry.id) || requests.has(request)) fail('Duplicate automation receipt.')
    ids.add(entry.id)
    requests.add(request)
    const prior = old.get(entry.id)
    if (prior && canonicalAutomationValue(prior) !== canonicalAutomationValue(entry))
      fail('Committed automation receipts are immutable.')
  }
}

/** Object order and omitted undefined fields are insignificant; array order is significant. */
export function canonicalAutomationValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalAutomationValue).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalAutomationValue(entry)}`).join(',')}}`
  }
  return JSON.stringify(value)
}
