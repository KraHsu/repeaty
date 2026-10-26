import { z } from 'zod'
import { classifyWorkspaceChanges, type AcceptedFile } from './changes'
import { readWorkspaceMarkdown } from './markdown'

const path = z.string().min(1).max(32_768)
export const previewStatusSchema = z.object({
  epoch: z.uuid(),
  active: z.object({ path, id: z.uuid(), token: z.uuid() }).nullable(),
  recent: z.array(z.object({ path, id: z.uuid() })).max(8),
  restore_error: z.string().nullable(),
})
export type PreviewStatus = z.infer<typeof previewStatusSchema>
export const previewScanSchema = z.object({
  token: z.uuid(),
  complete: z.boolean(),
  accepted: z
    .array(
      z.object({
        id: z.string(),
        path,
        raw: z.string().max(2 * 1024 * 1024),
        cards: z.array(
          z.object({
            id: z.string(),
            variant: z.string(),
            lifecycle: z.enum(['active', 'retired']),
          }),
        ),
      }),
    )
    .max(4096),
  observations: z
    .array(
      z.object({
        path,
        raw: z
          .string()
          .max(2 * 1024 * 1024)
          .optional(),
        error: z.string().optional(),
      }),
    )
    .max(4096),
  issues: z.array(z.string()),
})
export type PreviewScan = z.infer<typeof previewScanSchema>

/** Inspection only: classification does not accept changes or touch an active learning library. */
export function inspectPreview(scan: PreviewScan) {
  let bytes = 0
  const accepted: AcceptedFile[] = scan.accepted.map((file) => {
    bytes += new TextEncoder().encode(file.raw).byteLength
    const parsed = readWorkspaceMarkdown(file.raw)
    if (
      parsed.status !== 'managed' ||
      parsed.document.identity.kind !== 'note' ||
      parsed.document.identity.id !== file.id
    )
      throw new Error('invalid-accepted-manifest')
    return {
      path: file.path,
      document: parsed.document,
      cards: file.cards.map((card) => ({
        cardId: card.id,
        variant: card.variant,
        lifecycle: card.lifecycle,
      })),
    }
  })
  for (const file of scan.observations)
    if (file.raw !== undefined) bytes += new TextEncoder().encode(file.raw).byteLength
  if (bytes > 32 * 1024 * 1024) throw new Error('preview-limit')
  return classifyWorkspaceChanges(accepted, scan.observations, {
    completeScan: scan.complete,
    caseSensitive: false,
  }).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
}
