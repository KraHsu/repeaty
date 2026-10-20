import { z } from 'zod'
import { mediaSchema } from './model'
import { excerptSchema } from './source-data'

export const MAX_DRAFTS = 50
const id = z.string().min(1).max(100)
export const cardDraftSchema = z
  .strictObject({
    version: z.literal(1),
    id: z.uuid(),
    position: z.number().int().nonnegative().safe(),
    selectionId: z.uuid(),
    scope: z.string().startsWith('local:').max(512),
    mediaId: id,
    deckId: id,
    title: z.string().min(1).max(160),
    format: z.enum(['plain', 'markdown']),
    excerpt: excerptSchema,
    receivedAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    // Drafts may be incomplete. Formal note and cloze validation runs on confirmation.
    input: z.strictObject({
      type: z.enum(['basic', 'reversed', 'cloze']),
      format: z.enum(['plain', 'markdown']),
      front: z.string().max(10_000),
      back: z.string().max(10_000),
      tags: z.array(z.string().trim().min(1).max(40)).max(20),
      frontMedia: z.array(id).max(8).default([]),
      backMedia: z.array(id).max(8).default([]),
    }),
    uploads: z.array(z.strictObject({ meta: mediaSchema, blob: z.instanceof(Blob) })).max(16),
  })
  .superRefine((draft, ctx) => {
    const ids = [...draft.input.frontMedia, ...draft.input.backMedia]
    const assets = new Map(draft.uploads.map((asset) => [asset.meta.id, asset]))
    if (
      assets.size !== draft.uploads.length ||
      ids.some((id) => !assets.has(id)) ||
      draft.uploads.some(
        ({ meta, blob }) =>
          !ids.includes(meta.id) ||
          meta.type.startsWith('text/') ||
          meta.size !== blob.size ||
          meta.type !== blob.type,
      )
    )
      ctx.addIssue({ code: 'custom', message: '草稿附件不完整。' })
  })
export type CardDraft = z.infer<typeof cardDraftSchema>
