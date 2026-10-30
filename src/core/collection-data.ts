import { z } from 'zod'
import { materialMetadataSchema, materialPathSchema } from './material-data'

const id = z.string().min(1).max(100)
const hash = z.string().regex(/^[a-f0-9]{64}$/)
export const inboxSchema = z.strictObject({
  state: z.enum(['new', 'archived']),
  capturedAt: z.iso.datetime(),
  kind: z.enum(['text', 'file', 'clipboard', 'global', 'connector']),
  name: z.string().max(2048).optional(),
})
export const sourceBindingSchema = z.strictObject({
  connectionId: id,
  key: z.string().min(1).max(2048),
  fingerprint: hash,
  /** Version accepted from the upstream; differing current media means local edits. */
  acceptedMediaId: id,
  missing: z.boolean().optional(),
  links: z
    .array(
      z.strictObject({
        targetKey: z.string().min(1).max(2048),
        label: z.string().max(2048).optional(),
        anchor: z.string().max(2048).optional(),
      }),
    )
    .max(2000)
    .optional(),
})
export const sourceConnectionSchema = z.strictObject({
  id,
  pluginId: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,79}$/),
  connectorId: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
  title: z.string().trim().min(1).max(160),
  mode: z.enum(['import', 'index']),
  status: z.enum(['connected', 'disconnected']),
  settings: materialMetadataSchema,
  intervalHours: z.union([
    z.literal(0),
    z.literal(1),
    z.literal(12),
    z.literal(24),
    z.literal(168),
  ]),
  cursor: z.string().max(16384).optional(),
  checkedAt: z.iso.datetime().optional(),
  createdAt: z.iso.datetime(),
  /** Portable identity only. The authorized absolute path belongs to the device. */
  generation: z.number().int().nonnegative(),
})
export const sourceCandidateSchema = z
  .strictObject({
    id,
    connectionId: id,
    key: z.string().min(1).max(2048),
    fingerprint: hash,
    kind: z.enum(['add', 'update', 'missing']),
    sourceId: id.optional(),
    baseMediaId: id.optional(),
    title: z.string().trim().min(1).max(160),
    format: z.enum(['plain', 'markdown']),
    url: z
      .string()
      .max(2048)
      .regex(/^(?:https?:\/\/[^\s]+)?$/),
    mediaId: id.optional(),
    characters: z.number().int().min(1).max(250000).optional(),
    path: materialPathSchema.optional(),
    resources: z
      .array(z.strictObject({ path: materialPathSchema, mediaId: id }))
      .max(2000)
      .refine((rows) => new Set(rows.map((r) => r.path)).size === rows.length)
      .optional(),
    links: sourceBindingSchema.shape.links,
    discoveredAt: z.iso.datetime(),
    dismissed: z.boolean().optional(),
  })
  .refine((c) =>
    c.kind === 'missing' ? !!c.sourceId && !c.mediaId : !!c.mediaId && !!c.characters,
  )
export type SourceConnection = z.infer<typeof sourceConnectionSchema>
export type SourceCandidate = z.infer<typeof sourceCandidateSchema>
