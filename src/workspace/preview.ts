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
export function inspectPreview(scan: PreviewScan, parse = readWorkspaceMarkdown) {
  let bytes = 0
  const accepted: AcceptedFile[] = scan.accepted.map((file) => {
    bytes += new TextEncoder().encode(file.raw).byteLength
    const parsed = parse(file.raw)
    if (
      parsed.status !== 'managed' ||
      !['note', 'source'].includes(parsed.document.identity.kind) ||
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
    parse,
  }).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
}
/** Reuse parsed unchanged files without retaining earlier versions indefinitely. */
export function createPreviewInspector(parse = readWorkspaceMarkdown) {
  let cache = new Map<string, ReturnType<typeof readWorkspaceMarkdown>>()
  return (scan: PreviewScan) => {
    const next = new Map<string, ReturnType<typeof readWorkspaceMarkdown>>()
    const changes = inspectPreview(scan, (raw) => {
      const parsed = cache.get(raw) ?? next.get(raw) ?? parse(raw)
      next.set(raw, parsed)
      return parsed
    })
    cache = next
    return changes
  }
}
export interface PreviewPatch {
  token: string
  complete: boolean
  issues: string[]
  accepted: PreviewScan['accepted']
  observations: PreviewScan['observations']
  removeAccepted: string[]
  removeObservations: string[]
}
export function previewPatch(before: PreviewScan, after: PreviewScan): PreviewPatch {
  const accepted = new Map(before.accepted.map((entry) => [entry.path, entry]))
  const observed = new Map(before.observations.map((entry) => [entry.path, entry]))
  return {
    token: after.token,
    complete: after.complete,
    issues: after.issues,
    accepted: after.accepted.filter((entry) => {
      const old = accepted.get(entry.path)
      accepted.delete(entry.path)
      return (
        !old || old.raw !== entry.raw || JSON.stringify(old.cards) !== JSON.stringify(entry.cards)
      )
    }),
    observations: after.observations.filter((entry) => {
      const old = observed.get(entry.path)
      observed.delete(entry.path)
      return !old || old.raw !== entry.raw || old.error !== entry.error
    }),
    removeAccepted: [...accepted.keys()],
    removeObservations: [...observed.keys()],
  }
}
export function createPreviewReceiver() {
  let state: PreviewScan | undefined
  const inspect = createPreviewInspector()
  return (input: { scan?: PreviewScan; patch?: PreviewPatch }) => {
    if (input.scan) state = input.scan
    else {
      const patch = input.patch
      if (!state || !patch || state.token !== patch.token) throw new Error('invalid-scan-session')
      const accepted = new Map(state.accepted.map((entry) => [entry.path, entry]))
      const observed = new Map(state.observations.map((entry) => [entry.path, entry]))
      patch.removeAccepted.forEach((path) => accepted.delete(path))
      patch.removeObservations.forEach((path) => observed.delete(path))
      patch.accepted.forEach((entry) => accepted.set(entry.path, entry))
      patch.observations.forEach((entry) => observed.set(entry.path, entry))
      state = {
        token: patch.token,
        complete: patch.complete,
        issues: patch.issues,
        accepted: [...accepted.values()],
        observations: [...observed.values()],
      }
    }
    return inspect(previewScanSchema.parse(state))
  }
}
