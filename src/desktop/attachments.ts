import { z } from 'zod'
import { currentWorkspace, workspaceApi, workspaceStatus, type NativeApi } from './workspaces'

const count = z.number().int().nonnegative()
export const attachmentEntrySchema = z.object({
  id: z.string(),
  name: z.string(),
  path: z.string(),
  mime: z.string(),
  size: count,
  hash: z.string(),
  state: z.enum(['referenced', 'unused', 'trash', 'external']),
  source: z.enum(['managed', 'external']),
  refs: z.record(z.string(), count),
  trashedAt: z.string().nullable(),
  available: z.boolean(),
})
export const attachmentInventorySchema = z.object({
  revision: count,
  inventoryToken: z.string(),
  entries: z.array(attachmentEntrySchema),
  totals: z.object({
    physicalBytes: count,
    uniqueBytes: count,
    duplicateBytes: count,
    objects: count,
    workingFiles: count,
    unused: count,
    trash: count,
    external: count,
  }),
  pluginProtection: z.boolean(),
})
export type AttachmentEntry = z.infer<typeof attachmentEntrySchema>
export type AttachmentInventory = z.infer<typeof attachmentInventorySchema>
export type AttachmentAction = 'trash' | 'restore' | 'purge'
export function canManageAttachment(entry: AttachmentEntry, action: AttachmentAction) {
  if (entry.source !== 'managed' || !entry.available) return false
  if (action === 'restore') return entry.state === 'trash'
  return (
    Object.values(entry.refs).every((count) => count === 0) &&
    entry.state === (action === 'trash' ? 'unused' : 'trash')
  )
}
export function filterAttachments(
  entries: readonly AttachmentEntry[],
  query: string,
  state: string,
) {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  return entries.filter(
    (entry) =>
      (!state || entry.state === state) &&
      words.every((word) =>
        `${entry.name} ${entry.path} ${entry.id} ${entry.mime}`.toLocaleLowerCase().includes(word),
      ),
  )
}

/** Tokens are captured before requests; results from a changed library never enter the UI. */
export function createAttachmentClient(
  api: NativeApi = workspaceApi,
  scope = () => workspaceStatus.value?.active?.token,
) {
  let generation = 0
  const owners = new WeakMap<AttachmentInventory, string>()
  function cancel() {
    generation++
  }
  async function execute(request: Record<string, unknown>, write: boolean) {
    const call = ++generation
    const token = scope() ?? (await currentWorkspace()).token
    if (call !== generation) throw new DOMException('Aborted', 'AbortError')
    const value = await api<unknown>(write ? 'workspace_write' : 'workspace_read', {
      token,
      request,
    })
    if (call !== generation || token !== scope()) throw new DOMException('Aborted', 'AbortError')
    const inventory = attachmentInventorySchema.parse(value)
    owners.set(inventory, token)
    return inventory
  }
  return {
    cancel,
    load: () => execute({ type: 'attachment-inventory' }, false),
    mutate: (inventory: AttachmentInventory, action: AttachmentAction, ids: string[]) => {
      if (!owners.has(inventory) || owners.get(inventory) !== scope())
        return Promise.reject(new DOMException('Aborted', 'AbortError'))
      if (
        !ids.length ||
        ids.length > 500 ||
        new Set(ids).size !== ids.length ||
        ids.some((id) => {
          const entry = inventory.entries.find((entry) => entry.id === id)
          return !entry || !canManageAttachment(entry, action)
        })
      )
        return Promise.reject(new Error('Invalid attachment selection'))
      return execute(
        {
          type: 'attachment-mutate',
          expectedRevision: inventory.revision,
          inventoryToken: inventory.inventoryToken,
          action,
          ids,
        },
        true,
      )
    },
  }
}
