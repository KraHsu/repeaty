import { expect, it, vi } from 'vitest'
import { emptyLibrary } from '../core/model'
import { fixture } from '../core/test-fixtures'
import { snapshotFromLibrary } from './projection'
import { createSyncController, type SyncRequest } from './controller'
import type { SyncClock, SyncEvent, SyncSnapshot } from './protocol'

const group = 'group-one'
const event = (
  sequence: number,
  before: unknown = null,
  after: unknown = `value-${sequence}`,
): SyncEvent => ({
  protocol: 1,
  groupId: group,
  deviceId: 'other',
  id: `other:${sequence}`,
  sequence,
  clock: { other: sequence - 1 },
  changes: [{ store: 'values:plugin:reader', id: `key-${sequence}`, before, after }],
})
function harness(pending: SyncEvent[] = []) {
  let revision = 4,
    clock: SyncClock = {},
    source: SyncSnapshot = snapshotFromLibrary(emptyLibrary())
  let blocked: string | null = null,
    current = true
  const transport = {
    deviceId: 'this-device',
    enabled: true,
    paused: false,
    listenAddress: '192.168.1.8:43127',
    group,
    peers: [{ id: 'other', name: 'Other', address: '192.168.1.9:43127' }],
    pending: [],
    errors: [],
  }
  const request = vi.fn<SyncRequest>(async (method, payload) => {
    if (method === 'status')
      return {
        transport,
        journal: { groupId: group, clock, receivedClock: {}, pending: pending.length },
      }
    if (method === 'snapshot')
      return {
        snapshot: source,
        status: { groupId: group, clock, pending: pending.length },
        revision,
      }
    if (method === 'journal/status')
      return { groupId: group, clock, pending: pending.length, receivedClock: {} }
    if (method === 'journal/list') {
      const args = payload as { clock: SyncClock; limit: number }
      return pending
        .filter((entry) => entry.sequence > (args.clock[entry.deviceId] ?? 0))
        .slice(0, args.limit)
    }
    if (method === 'objects/info') return { objects: [], chunkSize: 262144 }
    if (method === 'cancel' || method === 'deactivate') return null
    throw new Error(`unexpected:${method}`)
  })
  const apply = vi.fn(async () => {})
  const controller = createSyncController({
    scope: 'library-one',
    current: () => current,
    blockedReason: () => blocked,
    request,
    apply,
  })
  return {
    controller,
    request,
    apply,
    transport,
    setRevision: (value: number) => {
      revision = value
    },
    setSnapshot: (value: SyncSnapshot) => {
      source = value
    },
    setBlocked: (value: string | null) => {
      blocked = value
    },
    setCurrent: (value: boolean) => {
      current = value
    },
    setClock: (value: SyncClock) => {
      clock = value
    },
  }
}

it('previews all pages without applying or advancing the journal clock, then commits explicitly', async () => {
  const test = harness(Array.from({ length: 130 }, (_, index) => event(index + 1)))
  await test.controller.run({ type: 'refresh' })
  await test.controller.run({ type: 'preview' })
  expect(test.controller.state.value.preview).toEqual({ changes: 130, events: 130 })
  expect(test.apply).not.toHaveBeenCalled()
  expect(test.request.mock.calls.filter(([method]) => method === 'journal/list')).toHaveLength(3)
  await test.controller.run({ type: 'apply' })
  expect(test.apply).toHaveBeenCalledOnce()
  const args = test.apply.mock.calls[0] as unknown as [
    string,
    number,
    unknown,
    {
      sync: {
        expectedClock: SyncClock
        clock: SyncClock
        appliedIds: string[]
        values: unknown
        retiredMedia: unknown
      }
    },
  ]
  expect(args[0]).toBe('library-one')
  expect(args[1]).toBe(4)
  expect(args[3].sync.expectedClock).toEqual({})
  expect(args[3].sync.clock).toEqual({ other: 130 })
  expect(args[3].sync.appliedIds).toHaveLength(130)
  expect(args[3].sync.retiredMedia).toEqual({})
  expect(test.request.mock.calls.some(([method]) => method === 'journal/receive')).toBe(false)
})

it('keeps unresolved data and a selected choice until the explicit apply transaction', async () => {
  const test = harness([event(1, 'original', 'remote')])
  const snapshot = snapshotFromLibrary(emptyLibrary())
  snapshot.values['plugin:reader'] = { 'key-1': { value: 'local', position: 0 } }
  test.setSnapshot(snapshot)
  await test.controller.run({ type: 'refresh' })
  await test.controller.run({ type: 'preview' })
  const conflict = test.controller.state.value.conflicts[0]!
  expect(test.controller.state.value.preview).toBeNull()
  await test.controller.run({ type: 'apply' })
  expect(test.apply).not.toHaveBeenCalled()
  await test.controller.run({ type: 'resolve', id: conflict.id, choice: 'remote' })
  expect(test.controller.state.value.conflicts).toEqual([])
  expect(test.controller.state.value.preview?.events).toBe(1)
  await test.controller.run({ type: 'preview' })
  expect(test.controller.state.value.conflicts).toEqual([])
  expect(test.apply).not.toHaveBeenCalled()
  await test.controller.run({ type: 'apply' })
  const options = (test.apply.mock.calls[0] as unknown as unknown[])[3] as {
    sync: { values: unknown; resolutions: unknown[] }
  }
  expect(options.sync.values).toEqual({ 'plugin:reader': { 'key-1': 'remote' } })
  expect(options.sync.resolutions.length).toBeGreaterThan(0)
})

it('drops outdated conflict choices when a fresh preview has different local content', async () => {
  const test = harness([event(1, 'original', 'remote')])
  const source = snapshotFromLibrary(emptyLibrary())
  source.values['plugin:reader'] = { 'key-1': { value: 'local', position: 0 } }
  test.setSnapshot(source)
  await test.controller.run({ type: 'preview' })
  const conflict = test.controller.state.value.conflicts[0]!
  expect(conflict.label).toBe('key-1')
  await test.controller.run({ type: 'resolve', id: conflict.id, choice: 'remote' })
  source.values['plugin:reader']!['key-1']!.value = 'new local edit'
  test.setRevision(5)
  await test.controller.run({ type: 'preview' })
  expect(test.controller.state.value.error).toBeNull()
  expect(test.controller.state.value.conflicts[0]?.id).not.toBe(conflict.id)
  expect(test.controller.state.value.conflicts[0]?.local).toBe('new local edit')
  expect(test.apply).not.toHaveBeenCalled()
})

it('does not keep an earlier success message when a new action fails', async () => {
  const test = harness([event(1)])
  await test.controller.run({ type: 'preview' })
  await test.controller.run({ type: 'apply' })
  expect(test.controller.state.value.message).toBe('同步更新已合入学习库。')
  test.request.mockRejectedValue(new Error('sync-batch-limit'))
  await test.controller.run({ type: 'preview' })
  expect(test.controller.state.value.message).toBeNull()
  expect(test.controller.state.value.error).toContain('本次未合入')
})

it('labels note conflicts with a readable question and unwraps the versions for display', async () => {
  const library = fixture({ front: '**植物**如何感知<span>光照</span>？' })
  const note = library.notes[0]!
  const pending = event(1)
  pending.changes = JSON.parse(
    JSON.stringify([
      {
        store: 'notes',
        id: note.id,
        before: { ...note, front: 'Original question' },
        after: { ...note, front: 'Remote question' },
      },
    ]),
  )
  const test = harness([pending])
  test.setSnapshot(snapshotFromLibrary(library))
  await test.controller.run({ type: 'preview' })
  expect(test.controller.state.value.conflicts[0]).toMatchObject({
    recordId: note.id,
    label: '植物如何感知光照？',
    fields: ['front'],
    local: '**植物**如何感知<span>光照</span>？',
    remote: 'Remote question',
  })
})

it('rechecks study state, revision and clock at the apply boundary', async () => {
  const test = harness([event(1)])
  await test.controller.run({ type: 'preview' })
  test.setBlocked('editing')
  await test.controller.run({ type: 'apply' })
  expect(test.apply).not.toHaveBeenCalled()
  test.setBlocked(null)
  test.setRevision(5)
  await test.controller.run({ type: 'apply' })
  expect(test.apply).not.toHaveBeenCalled()
  expect(test.controller.state.value.error).toContain('重新预览')
  expect(test.controller.state.value.preview).toBeNull()
  await test.controller.run({ type: 'preview' })
  test.setClock({ new: 1 })
  await test.controller.run({ type: 'apply' })
  expect(test.apply).not.toHaveBeenCalled()
})

it('can preview an offline backlog larger than 2048 events without silently truncating it', async () => {
  const test = harness(Array.from({ length: 2049 }, (_, index) => event(index + 1)))
  await test.controller.run({ type: 'preview' })
  expect(test.controller.state.value.error).toBeNull()
  expect(test.controller.state.value.preview?.events).toBe(2049)
  expect(test.apply).not.toHaveBeenCalled()
})

it('rejects a preview when the group changes without a library revision change', async () => {
  const test = harness([event(1)]),
    original = test.request.getMockImplementation()!
  await test.controller.run({ type: 'preview' })
  test.request.mockImplementation(async (method, payload) => {
    const result = await original(method, payload)
    return method === 'snapshot'
      ? { ...(result as object), status: { groupId: 'new-group', clock: {}, pending: 1 } }
      : result
  })
  await test.controller.run({ type: 'apply' })
  expect(test.apply).not.toHaveBeenCalled()
  expect(test.controller.state.value.preview).toBeNull()
  expect(test.controller.state.value.error).toContain('重新预览')
})

it('does not cancel a transaction that has entered the commit boundary', async () => {
  const test = harness([event(1)])
  let finish!: () => void
  test.apply.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve
      }),
  )
  await test.controller.run({ type: 'preview' })
  const applying = test.controller.run({ type: 'apply' })
  await vi.waitFor(() => expect(test.apply).toHaveBeenCalledOnce())
  await test.controller.run({ type: 'cancel' })
  expect(test.request.mock.calls.some(([method]) => method === 'cancel')).toBe(false)
  expect(test.controller.state.value.message).toContain('正在提交合入')
  finish()
  await applying
  expect(test.controller.state.value.message).toBe('同步更新已合入学习库。')
})

it('clears invitations and previews when leaving without replacing learning data', async () => {
  const test = harness([event(1)]),
    original = test.request.getMockImplementation()!
  let left = false
  test.request.mockImplementation(async (method, payload) => {
    if (method === 'leave') {
      left = true
      return null
    }
    if (method === 'invite') return { secret: 'private-invitation' }
    if (method === 'status' && left)
      return {
        transport: { ...test.transport, group: null, enabled: false, peers: [] },
        journal: { groupId: null, clock: {}, pending: 0, receivedClock: {} },
      }
    return original(method, payload)
  })
  await test.controller.run({ type: 'preview' })
  await test.controller.run({ type: 'invite' })
  expect(test.controller.state.value.invite).not.toBeNull()
  await test.controller.run({ type: 'leave' })
  expect(test.controller.state.value.invite).toBeNull()
  expect(test.controller.state.value.preview).toBeNull()
  expect(test.controller.state.value.groupId).toBeNull()
  expect(test.apply).not.toHaveBeenCalled()
})

it('does not revive historical transport errors and clears old invitations if the group changes', async () => {
  const test = harness([event(1)]),
    original = test.request.getMockImplementation()!
  let nextGroup = group
  test.request.mockImplementation(async (method, payload) => {
    if (method === 'invite') return { secret: 'private-invitation' }
    if (method === 'status')
      return {
        transport: { ...test.transport, group: nextGroup, errors: ['sync-disconnected'] },
        journal: { groupId: nextGroup, clock: {}, pending: 1, receivedClock: {} },
      }
    return original(method, payload)
  })
  await test.controller.run({ type: 'refresh' })
  expect(test.controller.state.value.error).toBeNull()
  await test.controller.run({ type: 'preview' })
  await test.controller.run({ type: 'invite' })
  nextGroup = 'replacement-group'
  await test.controller.refresh()
  expect(test.controller.state.value.invite).toBeNull()
  expect(test.controller.state.value.preview).toBeNull()
  expect(test.controller.state.value.error).toBeNull()
})

it('stages a bidirectional exchange and resumes only missing attachment chunks', async () => {
  const test = harness()
  const original = test.request.getMockImplementation()!
  const object = {
    kind: 'media',
    id: 'attachment',
    mime: 'application/pdf',
    hash: 'a'.repeat(64),
    size: 262144 * 2 + 5,
  }
  const written: number[] = []
  const received: string[] = []
  let sent = false
  test.request.mockImplementation(async (method, payload) => {
    if (method === 'objects/info') return { objects: [object], chunkSize: 262144 }
    if (method === 'objects/read') {
      const offset = (payload as { offset: number }).offset
      return { offset, data: 'eA==', chunkHash: 'b'.repeat(64) }
    }
    if (method === 'journal/receive') {
      received.push(...(payload as { events: SyncEvent[] }).events.map((entry) => entry.id))
      return { receivedClock: { other: 1 } }
    }
    if (method === 'peer') {
      const peer = payload as { method: string; payload: Record<string, unknown> }
      if (peer.method === 'journal/status')
        return { groupId: group, clock: {}, pending: 0, receivedClock: {} }
      if (peer.method === 'journal/list') {
        if (sent) return []
        sent = true
        return [event(1)]
      }
      if (peer.method === 'objects/info')
        return peer.payload.object
          ? { complete: false, received: [1], chunkSize: 262144 }
          : { objects: [], chunkSize: 262144 }
      if (peer.method === 'objects/write') {
        written.push(peer.payload.offset as number)
        return { complete: false, received: [0, 1, 2], chunkSize: 262144 }
      }
      if (peer.method === 'objects/finish') return { complete: true }
      throw new Error(`unexpected-peer:${peer.method}`)
    }
    return original(method, payload)
  })
  await test.controller.run({ type: 'exchange' })
  expect(test.controller.state.value.error).toBeNull()
  expect(written).toEqual([0, 524288])
  expect(received).toEqual(['other:1'])
  expect(test.apply).not.toHaveBeenCalled()
  expect(test.controller.state.value.preview).toBeNull()
})

it('prepares the invited group before listening and keeps invitation secrets out of errors', async () => {
  const test = harness()
  const original = test.request.getMockImplementation()!
  test.request.mockImplementation(async (method, payload) => {
    if (['prepareJoin', 'listen', 'join'].includes(method)) return {}
    return original(method, payload)
  })
  await test.controller.run({ type: 'listen', address: '192.168.1.11:43127' })
  expect(test.request).toHaveBeenLastCalledWith('status', {})
  test.request.mockClear()
  await test.controller.run({ type: 'join', invite: '{"groupId":"group-one","secret":"private"}' })
  expect(test.request.mock.calls.slice(0, 3).map(([method]) => method)).toEqual([
    'prepareJoin',
    'listen',
    'join',
  ])
  expect(JSON.stringify(test.controller.state.value)).not.toContain('private')
  test.request.mockImplementation(async () => {
    throw new Error('private-secret-from-transport')
  })
  await test.controller.run({ type: 'invite' })
  expect(test.controller.state.value.error).not.toContain('private-secret')
})

it('invalidates in-flight replies on cancellation and disposes native resources once', async () => {
  const test = harness()
  const original = test.request.getMockImplementation()!
  let complete!: (value: unknown) => void
  test.request.mockImplementation((method, payload) =>
    method === 'status'
      ? new Promise((resolve) => {
          complete = resolve
        })
      : original(method, payload),
  )
  const reading = test.controller.run({ type: 'refresh' })
  await test.controller.run({ type: 'cancel' })
  complete({ transport: test.transport, journal: { groupId: 'stale', clock: {}, pending: 5 } })
  await reading
  expect(test.controller.state.value.groupId).toBeNull()
  expect(test.controller.state.value.pending).toBe(0)
  await Promise.all([test.controller.dispose(), test.controller.dispose()])
  expect(test.request.mock.calls.filter(([method]) => method === 'deactivate')).toHaveLength(1)
  expect(test.controller.state.value.available).toBe(false)
})
