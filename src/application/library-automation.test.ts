import 'fake-indexeddb/auto'
import { afterEach, expect, it, vi } from 'vitest'
import { createLibraryState } from '../composables/library-state'
import { fixture } from '../core/test-fixtures'
import { createRepository } from '../core/storage'
import { createLibraryService } from './library'
import type { AutomationCommand, AutomationRequest, AutomationScope } from '@repeaty/plugin-api'
import type { RetiredNote } from '../desktop/retirement'
const services: ReturnType<typeof createLibraryService>[] = []
afterEach(async () => {
  for (const service of services.splice(0)) await service.commands.close()
  vi.restoreAllMocks()
})
async function setup(name = `automation-${crypto.randomUUID()}`, seed = true) {
  const repo = createRepository(name)
  if (seed) await repo.save(fixture(), 0)
  const state = createLibraryState(),
    service = createLibraryService(state, {
      createWorkspaceRepository: async () => repo,
      remoteWorkspace: { value: false },
      desktopEdition: false,
      canReviewCard: () => true,
    })
  services.push(service)
  await service.commands.init()
  expect(state.ready.value).toBe(true)
  const controller = new AbortController(),
    consent = { authorize: vi.fn(async () => true), apply: vi.fn(async () => true) }
  const activate = (actorId = 'plugin:assistant') =>
    service.commands.automationApi(
      {
        actorId,
        label: 'Assistant',
        scope: state.scope.value,
        signal: controller.signal,
        assertCurrent: () => {},
      },
      consent,
    )
  const api = activate()
  const grant = async (scope: AutomationScope = { kind: 'all' }, write = true) =>
    api.authorize({ scope, write })
  const request = (...commands: AutomationCommand[]): AutomationRequest => ({
    protocolVersion: 1,
    operationId: crypto.randomUUID(),
    expectedRevision: service.commands.localLearningSnapshot(state.scope.value).revision,
    commands,
  })
  const apply = async (...commands: AutomationCommand[]) => {
    const plan = await api.preview(request(...commands))
    return api.apply({ planId: plan.planId, request: plan.request, fingerprint: plan.fingerprint })
  }
  return { name, repo, state, service, api, controller, consent, activate, grant, request, apply }
}
it('requires host consent; preview does not write, uses stable IDs and persists one receipt', async () => {
  const t = await setup(),
    save = vi.spyOn(t.repo, 'save')
  await expect(t.api.query({ kind: 'library' })).rejects.toThrow('permission-denied')
  t.consent.authorize.mockResolvedValueOnce(false)
  await expect(t.grant()).rejects.toThrow('permission-denied')
  await t.grant()
  const request = t.request({
      kind: 'source.create',
      input: { title: 'Material', body: 'Content' },
    }),
    plan = await t.api.preview(request)
  expect(await t.api.preview(request)).toEqual(plan)
  expect(save).not.toHaveBeenCalled()
  expect(t.state.library.value.sources).toHaveLength(0)
  const result = await t.api.apply({ planId: plan.planId, request, fingerprint: plan.fingerprint })
  expect(save).toHaveBeenCalledTimes(1)
  expect(result.resultIds.sources).toEqual(plan.resultIds.sources)
  expect(t.state.library.value.automationReceipts).toHaveLength(1)
  expect((await t.repo.load()).library.automationReceipts[0]?.result.revision).toBe(result.revision)
  expect(
    (await t.api.query({ kind: 'source.body', sourceId: result.resultIds.sources[0]! })) as object,
  ).toMatchObject({ text: 'Content' })
})
it('lost replies replay after restart; undo never makes a retry execute again', async () => {
  const t = await setup()
  await t.grant()
  const request = t.request({ kind: 'deck.create', input: { name: 'Created once' } }),
    plan = await t.api.preview(request),
    input = { request, fingerprint: plan.fingerprint, planId: plan.planId }
  const result = await t.api.apply(input)
  await t.service.commands.undoLastOperation()
  expect(t.state.library.value.decks).toHaveLength(1)
  expect(await t.api.apply(input)).toEqual({ ...result, replayed: true })
  expect(t.state.library.value.decks).toHaveLength(1)
  await t.service.commands.close()
  const reopened = await setup(t.name, false)
  await reopened.grant()
  expect(await reopened.api.apply({ request, fingerprint: plan.fingerprint })).toEqual({
    ...result,
    replayed: true,
  })
  expect(reopened.state.library.value.decks).toHaveLength(1)
})
it('failed saves commit neither data nor receipt; the same preview is retryable', async () => {
  const t = await setup()
  await t.grant()
  const plan = await t.api.preview(t.request({ kind: 'deck.create', input: { name: 'Retry' } })),
    input = { request: plan.request, fingerprint: plan.fingerprint, planId: plan.planId }
  vi.spyOn(t.repo, 'save').mockRejectedValueOnce(new Error('disk-full'))
  await expect(t.api.apply(input)).rejects.toThrow('disk-full')
  expect(t.state.library.value.automationReceipts).toHaveLength(0)
  expect(t.state.library.value.decks).toHaveLength(1)
  expect((await t.api.apply(input)).replayed).toBe(false)
})
it('rejects stale previews, changed request IDs, revoked grants and deactivated actors', async () => {
  const t = await setup()
  await t.grant()
  const plan = await t.api.preview(t.request({ kind: 'deck.create', input: { name: 'A' } })),
    input = { request: plan.request, fingerprint: plan.fingerprint, planId: plan.planId }
  await t.apply({ kind: 'deck.create', input: { name: 'B' } })
  await expect(t.api.apply(input)).rejects.toThrow('library-changed')
  const plan2 = await t.api.preview(t.request({ kind: 'deck.create', input: { name: 'C' } }))
  t.api.revoke()
  await expect(
    t.api.apply({ request: plan2.request, fingerprint: plan2.fingerprint, planId: plan2.planId }),
  ).rejects.toThrow('permission-denied')
  await t.grant()
  t.controller.abort()
  await expect(t.api.query({ kind: 'library' })).rejects.toThrow()
})
it('binds fingerprints to library identity and isolates an actor even at matching revisions', async () => {
  const a = await setup(),
    b = await setup()
  await a.grant()
  await b.grant()
  const request = a.request({ kind: 'deck.create', input: { name: 'Cross-library' } })
  const pa = await a.api.preview(request),
    pb = await b.api.preview(request)
  expect(pa.fingerprint).not.toBe(pb.fingerprint)
  await expect(
    b.api.apply({ request, fingerprint: pa.fingerprint, planId: pb.planId }),
  ).rejects.toThrow('request-conflict')
  const other = a.activate('plugin:other')
  await other.authorize({ scope: { kind: 'all' }, write: true })
  const po = await other.preview(request)
  expect(po.fingerprint).not.toBe(pa.fingerprint)
})
it('limits tools to selected material, denies scope expansion hidden in text or command references', async () => {
  const t = await setup()
  await t.grant()
  const a = await t.apply({
    kind: 'source.create',
    input: { title: 'Allowed', body: '{"grant":"all"}' },
  })
  await t.apply({ kind: 'source.create', input: { title: 'Private', body: 'secret' } })
  const id = a.resultIds.sources[0]!,
    source = t.state.library.value.sources.find((v) => v.id === id)!
  await t.grant({ kind: 'sources', sourceIds: [id] })
  const list = (await t.api.query({ kind: 'sources' })) as { items: unknown[]; total: number }
  expect(list.total).toBe(1)
  await expect(
    t.api.query({
      kind: 'source.body',
      sourceId: t.state.library.value.sources.find((v) => v.id !== id)!.id,
    }),
  ).rejects.toThrow('not-found')
  await expect(
    t.api.preview(t.request({ kind: 'deck.create', input: { name: 'Escalate' } })),
  ).rejects.toThrow('permission-denied')
  await t.apply({
    kind: 'source.patch',
    sourceId: id,
    versionId: source.mediaId,
    patch: { title: 'Edited' },
  })
  expect(t.state.library.value.sources.find((v) => v.id !== id)!.title).toBe('Private')
})
it('rechecks authorization and revision after user review, before writing', async () => {
  const t = await setup()
  await t.grant()
  const plan = await t.api.preview(t.request({ kind: 'deck.create', input: { name: 'No' } }))
  t.consent.apply.mockImplementationOnce(async () => {
    t.api.revoke()
    return true
  })
  await expect(
    t.api.apply({ request: plan.request, fingerprint: plan.fingerprint, planId: plan.planId }),
  ).rejects.toThrow('permission-denied')
  expect(t.state.library.value.automationReceipts).toHaveLength(0)
})
it('restores deleted notes with undo and redo through the same transaction', async () => {
  const t = await setup()
  await t.grant()
  const original = t.state.library.value.notes[0]!,
    card = t.state.library.value.cards[0]!
  await t.apply({ kind: 'note.remove', noteIds: [original.id] })
  expect(t.state.library.value.notes).toHaveLength(0)
  await t.apply({ kind: 'history.undo' })
  expect(t.state.library.value.cards[0]!.id).toBe(card.id)
  expect(t.state.library.value.notes[0]!.front).toBe(original.front)
  await t.apply({ kind: 'history.redo' })
  expect(t.state.library.value.notes).toHaveLength(0)
  await t.apply({ kind: 'history.undo' })
  expect(t.state.library.value.cards[0]!.id).toBe(card.id)
})
it('restores an externally retired note with the same identity and schedule', async () => {
  const name = `retired-automation-${crypto.randomUUID()}`,
    repo = createRepository(name),
    original = fixture()
  const retired: RetiredNote = {
    revision: 0,
    note: original.notes[0]!,
    document: null,
    cards: original.cards,
    reviews: [],
    practices: [],
    attempts: [],
    media: [],
  }
  await repo.save({ ...original, notes: [], cards: [] }, 0, { retired: [retired] })
  await repo.close()
  const t = await setup(name, false)
  await t.grant()
  await t.apply({ kind: 'retired.restore', noteId: original.notes[0]!.id })
  expect(t.state.library.value.cards).toEqual(original.cards)
  expect(t.state.library.value.notes[0]!.id).toBe(original.notes[0]!.id)
})
it('restores checkpoints while retaining acknowledged receipts and clearing incompatible undo history', async () => {
  const t = await setup()
  await t.grant()
  await t.repo.backupNow(true)
  const checkpoint = (await t.repo.listBackups())[0]!
  const plan = await t.api.preview(
      t.request({ kind: 'deck.create', input: { name: 'After snapshot' } }),
    ),
    input = { request: plan.request, planId: plan.planId, fingerprint: plan.fingerprint }
  const result = await t.api.apply(input)
  await t.apply({ kind: 'checkpoint.restore', checkpointId: checkpoint.id })
  expect(t.state.library.value.decks).toHaveLength(1)
  expect(t.state.operations.value).toHaveLength(0)
  expect(await t.api.apply(input)).toEqual({ ...result, replayed: true })
  expect(t.state.library.value.decks).toHaveLength(1)
})
it('creates inside an authorized folder but refuses root-level creation', async () => {
  const t = await setup()
  await t.grant()
  const folders = await t.apply({ kind: 'folder.create', name: 'Allowed' })
  const folderId = folders.resultIds.folders[0]!
  await t.grant({ kind: 'folders', folderIds: [folderId] })
  await expect(
    t.apply({ kind: 'source.create', input: { title: 'Outside', body: 'No' } }),
  ).rejects.toThrow('permission-denied')
  const created = await t.apply({
    kind: 'source.create',
    destination: { folderId },
    input: { title: 'Inside', body: 'Yes' },
  })
  expect(
    t.state.library.value.sources.find((v) => v.id === created.resultIds.sources[0])?.folderId,
  ).toBe(folderId)
})

it('maintains independent reference collections, reorders, archives/restores and persists without moving sources', async () => {
  const t = await setup()
  await t.grant()
  const a = await t.apply({ kind: 'source.create', input: { title: 'A', body: 'A' } }),
    b = await t.apply({ kind: 'source.create', input: { title: 'B', body: 'B' } })
  const ids = [a.resultIds.sources[0]!, b.resultIds.sources[0]!],
    sources = t.state.library.value.sources
  const first = await t.apply({ kind: 'collection.create', name: 'First', sourceIds: ids }),
    second = await t.apply({ kind: 'collection.create', name: 'Second', sourceIds: [ids[0]!] })
  const collectionId = first.resultIds.collections[0]!
  expect(t.state.library.value.sources).toEqual(sources)
  await t.apply({ kind: 'collection.reorder', collectionId, sourceIds: [...ids].reverse() })
  expect(t.state.library.value.materialCollections[0]!.sourceIds).toEqual([...ids].reverse())
  expect(t.state.library.value.materialCollections[1]!.sourceIds).toEqual([ids[0]])
  await t.apply({ kind: 'collection.archive', collectionId })
  expect(await t.api.query({ kind: 'collections' })).toMatchObject({
    total: 1,
    items: [{ id: second.resultIds.collections[0] }],
  })
  expect(await t.api.query({ kind: 'collections', archived: true })).toMatchObject({
    total: 1,
    items: [{ id: collectionId }],
  })
  await t.apply({ kind: 'collection.restore', collectionId })
  expect(t.state.library.value.materialCollections[0]!.sourceIds).toEqual([...ids].reverse())
  await t.grant({ kind: 'sources', sourceIds: [ids[0]!] })
  expect(await t.api.query({ kind: 'collections' })).toMatchObject({ total: 0 })
  await expect(t.apply({ kind: 'collection.patch', collectionId, name: 'Denied' })).rejects.toThrow(
    'permission-denied',
  )
  await t.service.commands.close()
  const reopened = await setup(t.name, false)
  await reopened.grant()
  expect(await reopened.api.query({ kind: 'collections' })).toMatchObject({ total: 2 })
  expect(reopened.state.library.value.sources).toEqual(sources)
})
it('does not acquire ungranted materials by moving them into an authorized folder', async () => {
  const t = await setup()
  await t.grant()
  await t.apply(
    { kind: 'folder.create', name: 'Allowed' },
    { kind: 'folder.create', name: 'Private' },
    { kind: 'source.create', input: { title: 'Private material', body: 'Secret' } },
  )
  const folderId = t.state.library.value.materialFolders.find((v) => v.name === 'Allowed')!.id,
    privateFolderId = t.state.library.value.materialFolders.find((v) => v.name === 'Private')!.id,
    privateSourceId = t.state.library.value.sources[0]!.id
  await t.grant({ kind: 'folders', folderIds: [folderId] })
  await expect(
    t.api.preview(
      t.request({
        kind: 'source.move',
        sourceId: privateSourceId,
        destination: { folderId },
      }),
    ),
  ).rejects.toThrow('permission-denied')
  await expect(
    t.api.preview(
      t.request({
        kind: 'folder.move',
        folderId: privateFolderId,
        destination: { folderId },
      }),
    ),
  ).rejects.toThrow('permission-denied')
  expect(t.state.library.value.sources[0]!.folderId).toBeUndefined()
  expect(
    t.state.library.value.materialFolders.find((v) => v.id === privateFolderId)!.parentId,
  ).toBeUndefined()
})
it('discards a pending source body when authorization changes to exclude that source', async () => {
  const t = await setup()
  await t.grant()
  await t.apply(
    { kind: 'source.create', input: { title: 'Allowed', body: 'Allowed body' } },
    { kind: 'source.create', input: { title: 'Private', body: 'Secret body' } },
  )
  const allowedSource = t.state.library.value.sources.find((v) => v.title === 'Allowed')!,
    privateSource = t.state.library.value.sources.find((v) => v.title === 'Private')!,
    media = await t.repo.getMedia(privateSource.mediaId)
  let resolveRead!: (value: typeof media) => void, started!: () => void
  const reading = new Promise<void>((resolve) => {
    started = resolve
  })
  vi.spyOn(t.repo, 'getMedia').mockImplementationOnce(() => {
    started()
    return new Promise((resolve) => {
      resolveRead = resolve
    })
  })
  const pending = t.api.query({ kind: 'source.body', sourceId: privateSource.id })
  const denied = expect(pending).rejects.toThrow('permission-denied')
  await reading
  await t.grant({ kind: 'sources', sourceIds: [allowedSource.id] }, false)
  resolveRead(media)
  await denied
})
it('does not resurrect authorization when revoked during the consent prompt', async () => {
  const t = await setup()
  let resolveConsent!: (value: boolean) => void
  t.consent.authorize.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveConsent = resolve
      }),
  )
  const pending = t.grant()
  t.api.revoke()
  resolveConsent(true)
  await pending.catch(() => {})
  expect(t.api.capabilities()).toMatchObject({ readEnabled: false })
  await expect(t.api.query({ kind: 'library' })).rejects.toThrow('permission-denied')
})
it('does not let an older consent response overwrite a newer authorization', async () => {
  const t = await setup()
  let resolveOld!: (value: boolean) => void
  t.consent.authorize.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveOld = resolve
      }),
  )
  const old = t.grant()
  const current = await t.grant({ kind: 'all' }, false)
  resolveOld(true)
  await old.catch(() => {})
  expect(t.api.capabilities()).toMatchObject({ grant: current, writeEnabled: false })
})
it('rechecks authorization after fingerprinting before replaying a committed receipt', async () => {
  const t = await setup()
  await t.grant()
  const source = await t.apply({
    kind: 'source.create',
    input: { title: 'Allowed', body: 'Allowed body' },
  })
  const plan = await t.api.preview(
    t.request({ kind: 'deck.create', input: { name: 'Private deck' } }),
  )
  const input = { request: plan.request, planId: plan.planId, fingerprint: plan.fingerprint }
  await t.api.apply(input)
  let started!: () => void, resume!: () => void
  const hashing = new Promise<void>((resolve) => {
    started = resolve
  })
  const paused = new Promise<void>((resolve) => {
    resume = resolve
  })
  const digest = crypto.subtle.digest.bind(crypto.subtle)
  vi.spyOn(crypto.subtle, 'digest').mockImplementationOnce(async (...args) => {
    started()
    await paused
    return digest(...args)
  })
  const replay = t.api.apply(input)
  const denied = expect(replay).rejects.toThrow('permission-denied')
  await hashing
  await t.grant({ kind: 'sources', sourceIds: source.resultIds.sources }, true)
  resume()
  await denied
  expect(t.state.library.value.decks.filter((v) => v.name === 'Private deck')).toHaveLength(1)
})
it('does not expose or modify material collections with a partial source grant', async () => {
  const t = await setup()
  await t.grant()
  const source = await t.apply({
    kind: 'source.create',
    input: { title: 'Allowed', body: 'Allowed body' },
  })
  const sourceIds = source.resultIds.sources
  const collection = await t.apply({
    kind: 'collection.create',
    name: 'Private collection',
    sourceIds,
  })
  const collectionId = collection.resultIds.collections[0]!
  await t.grant({ kind: 'sources', sourceIds }, true)
  expect(await t.api.query({ kind: 'collections' })).toMatchObject({ items: [], total: 0 })
  expect(await t.api.query({ kind: 'library' })).toMatchObject({ counts: { collections: 0 } })
  const commands: AutomationCommand[] = [
    { kind: 'collection.create', name: 'Outside', sourceIds },
    { kind: 'collection.patch', collectionId, name: 'Changed' },
    { kind: 'collection.members', collectionId, remove: sourceIds },
    { kind: 'collection.reorder', collectionId, sourceIds },
    { kind: 'collection.archive', collectionId },
    { kind: 'collection.restore', collectionId },
  ]
  for (const command of commands)
    await expect(t.api.preview(t.request(command))).rejects.toThrow('permission-denied')
  expect(t.state.library.value.materialCollections[0]).toMatchObject({
    id: collectionId,
    name: 'Private collection',
    archived: false,
    sourceIds,
  })
})
