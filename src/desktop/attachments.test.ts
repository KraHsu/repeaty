import { expect, it, vi } from 'vitest'
import {
  canManageAttachment,
  createAttachmentClient,
  filterAttachments,
  type AttachmentInventory,
  type AttachmentEntry,
} from './attachments'
import type { NativeApi } from './workspaces'
export function attachment(id = 'unused', changes: Partial<AttachmentEntry> = {}): AttachmentEntry {
  return {
    id,
    name: `${id}.png`,
    path: `.repeaty/media/${id}.png`,
    mime: 'image/png',
    size: 4096,
    hash: 'a'.repeat(64),
    state: 'unused',
    source: 'managed',
    refs: {},
    trashedAt: null,
    available: true,
    ...changes,
  }
}
export function inventoryFixture(): AttachmentInventory {
  return {
    revision: 7,
    inventoryToken: 'token',
    entries: [attachment()],
    pluginProtection: false,
    totals: {
      physicalBytes: 4096,
      uniqueBytes: 4096,
      duplicateBytes: 0,
      objects: 1,
      workingFiles: 0,
      unused: 1,
      trash: 0,
      external: 0,
    },
  }
}
it('filters file metadata and keeps references, external data and missing bytes out of cleanup', () => {
  const entries = [
    attachment(),
    attachment('used', { state: 'referenced', refs: { retired: 1 } }),
    attachment('外部文件', { state: 'external', source: 'external' }),
  ]
  expect(filterAttachments(entries, 'image unused', '')).toEqual([entries[0]])
  expect(filterAttachments(entries, '', 'referenced')).toEqual([entries[1]])
  expect(filterAttachments(entries, '外部', '')).toEqual([entries[2]])
  expect(canManageAttachment(entries[0]!, 'trash')).toBe(true)
  for (const entry of [
    entries[1]!,
    entries[2]!,
    attachment('missing', { available: false }),
    attachment('private', { refs: { unknownPlugin: 1 } }),
  ])
    expect(canManageAttachment(entry, 'trash')).toBe(false)
  expect(
    canManageAttachment(attachment('trash', { state: 'trash', refs: { undo: 1 } }), 'purge'),
  ).toBe(false)
  expect(
    canManageAttachment(attachment('trash', { state: 'trash', refs: { undo: 1 } }), 'restore'),
  ).toBe(true)
})
it('binds mutations to the preview and rejects invalid selections without native writes', async () => {
  const api = vi.fn().mockResolvedValue(inventoryFixture())
  const client = createAttachmentClient(api as NativeApi, () => 'library-a')
  const inventory = await client.load()
  expect(api).toHaveBeenLastCalledWith('workspace_read', {
    token: 'library-a',
    request: { type: 'attachment-inventory' },
  })
  await expect(client.mutate(inventory, 'purge', ['unused'])).rejects.toThrow()
  await expect(client.mutate(inventory, 'trash', ['unused', 'unused'])).rejects.toThrow()
  expect(api).toHaveBeenCalledTimes(1)
  await client.mutate(inventory, 'trash', ['unused'])
  expect(api).toHaveBeenLastCalledWith('workspace_write', {
    token: 'library-a',
    request: {
      type: 'attachment-mutate',
      action: 'trash',
      expectedRevision: 7,
      inventoryToken: 'token',
      ids: ['unused'],
    },
  })
})
it('discards late results after cancellation or a library switch', async () => {
  let release!: (data: unknown) => void
  const api = vi.fn(
    () =>
      new Promise((resolve) => {
        release = resolve
      }),
  )
  let token = 'library-a'
  const client = createAttachmentClient(api as NativeApi, () => token)
  const request = client.load()
  client.cancel()
  release(inventoryFixture())
  await expect(request).rejects.toMatchObject({ name: 'AbortError' })
  const switched = client.load()
  token = 'library-b'
  release(inventoryFixture())
  await expect(switched).rejects.toMatchObject({ name: 'AbortError' })
})

it('never submits a preview from the previous library under a new session token', async () => {
  const api = vi.fn().mockResolvedValue(inventoryFixture())
  let token = 'library-a'
  const client = createAttachmentClient(api as NativeApi, () => token)
  const view = await client.load()
  token = 'library-b'
  await expect(client.mutate(view, 'trash', ['unused'])).rejects.toMatchObject({
    name: 'AbortError',
  })
  expect(api).toHaveBeenCalledTimes(1)
})
