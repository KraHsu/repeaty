import { z } from 'zod'
import { retiredSummarySchema } from './retirement'
export const documentSchema = z.object({
  kind: z.enum(['note', 'source']),
  id: z.string(),
  path: z.string(),
  hash: z.string(),
  raw: z.string(),
})
export const workingSchema = z.object({
  path: z.string(),
  hash: z.string().optional(),
  raw: z.string().optional(),
  error: z.string().optional(),
})
export const bindingSchema = z.object({
  kind: z.enum(['note', 'source']),
  id: z.string(),
  media: z.array(z.object({ path: z.string(), hash: z.string() })),
})
export const scanSchema = z.object({
  accepted: z.array(documentSchema),
  working: z.array(workingSchema),
  attention: z.array(z.object({ path: z.string(), status: z.string() })),
  scanHash: z.string(),
  retired: z.array(retiredSummarySchema),
  retiredCount: z.number().int().nonnegative().default(0),
  bindings: z.array(bindingSchema).default([]),
})
export type WorkspaceScan = z.infer<typeof scanSchema>
