import 'fake-indexeddb/auto'
import { openDB } from 'idb'
import { expect, it, vi } from 'vitest'
import { createRepository, recordStores } from './storage'
import { DraftSession, MAX_DRAFTS } from './draft-proposals'
import { fixture } from './test-fixtures'
import { addSource, prepareSource, sourceExcerpt } from './sources'
import { saveNote } from './model'
import { cardDraftSchema } from './card-draft-data'

async function setup() {
  const name = `drafts-${crypto.randomUUID()}`
  const repo = createRepository(name)
  const text = 'Private prefix\n选中这段文字🙂\nPrivate suffix'
  const { source, asset } = prepareSource({
    title: 'Source',
    url: '',
    format: 'markdown',
    content: text,
  })
  const library = addSource(fixture(), source, asset)
  const saved = await repo.save(library, 0, { assets: [asset] })
  const context = { ...saved, scope: repo.scope() }
  const session = new DraftSession()
  session.bindScope(context.scope)
  session.share(
    context,
    sourceExcerpt(source, text, text.indexOf('选'), text.indexOf('\nPrivate suffix')),
    'deck',
    source.mediaId,
    text,
  )
  const proposal = session.prepare(context, {
    selectionId: session.selection!.selectionId,
    requestId: 'one',
    cards: [
      { type: 'basic', front: 'Question', back: 'Answer' },
      { type: 'cloze', front: '{{c1::文字}}' },
    ],
  })
  return { name, repo, context, proposal, session }
}

it('reopens drafts in receive order with edits and attachment bytes, without restoring sharing or changing learning data', async () => {
  const { name, repo, context, proposal } = await setup()
  await repo.load()
  const backups = await repo.listBackups()
  await repo.addCardDrafts(proposal.drafts)
  const draft = proposal.drafts[0]!
  const blob = new Blob(['audio bytes'], { type: 'audio/mpeg' })
  const edited = cardDraftSchema.parse({
    ...draft,
    input: {
      ...draft.input,
      front: '',
      back: '尚未写完的答案',
      tags: ['edited'],
      frontMedia: ['audio'],
    },
    uploads: [
      {
        meta: {
          id: 'audio',
          name: 'sample.mp3',
          type: blob.type,
          size: blob.size,
          createdAt: draft.receivedAt,
        },
        blob,
      },
    ],
  })
  await repo.updateCardDraft(edited)
  await repo.addCardDrafts(proposal.drafts)
  expect(await repo.load()).toEqual(contextWithoutScope(context))
  expect(await repo.listBackups()).toEqual(backups)
  expect(await repo.completeLibrary()).not.toHaveProperty('cardDrafts')
  await repo.close()
  const reopened = createRepository(name)
  const drafts = await reopened.readCardDrafts()
  expect(drafts.map((draft) => draft.id)).toEqual(proposal.receipt.draftIds)
  expect(drafts[0]!.input).toMatchObject({ front: '', back: '尚未写完的答案', tags: ['edited'] })
  expect(await drafts[0]!.uploads[0]!.blob.text()).toBe('audio bytes')
  const next = new DraftSession()
  next.bindScope(context.scope)
  next.restore(context.scope, drafts)
  expect(next.selection).toBeUndefined()
  expect(() => next.readSelection(context, {})).toThrow('selection-unavailable')
  expect(() => next.prepare(context, { selectionId: proposal.drafts[0]!.selectionId })).toThrow(
    'selection-unavailable',
  )
  await reopened.discardCardDraft(drafts[0]!.id)
  await reopened.close()
  const again = createRepository(name)
  expect((await again.readCardDrafts()).map((draft) => draft.id)).toEqual([drafts[1]!.id])
  await again.close()
})

function contextWithoutScope({ library, revision }: Awaited<ReturnType<typeof setup>>['context']) {
  return { library, revision }
}

it('creates a confirmed note and consumes its draft in one transaction, rolling back both on failure', async () => {
  const { repo, proposal, context } = await setup()
  await repo.addCardDrafts(proposal.drafts)
  const draft = proposal.drafts[0]!
  const next = saveNote(context.library, {
    ...draft.input,
    deckId: draft.deckId,
    excerpt: draft.excerpt,
  })
  const originalPut = IDBObjectStore.prototype.put
  const fail = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
    this: IDBObjectStore,
    ...args: Parameters<typeof originalPut>
  ) {
    if (this.name === 'notes')
      throw new DOMException('Synthetic full storage', 'QuotaExceededError')
    return originalPut.apply(this, args)
  })
  try {
    await expect(
      repo.save(next, context.revision, { consumeCardDraft: draft.id, reason: 'confirm' }),
    ).rejects.toMatchObject({ name: 'QuotaExceededError' })
  } finally {
    fail.mockRestore()
  }
  expect(await repo.load()).toEqual(contextWithoutScope(context))
  expect(await repo.readCardDrafts()).toHaveLength(2)
  const saved = await repo.save(next, context.revision, {
    consumeCardDraft: draft.id,
    reason: 'confirm',
  })
  expect(saved.library.notes).toHaveLength(context.library.notes.length + 1)
  expect(saved.library.reviews).toEqual(context.library.reviews)
  expect((await repo.readCardDrafts()).map((entry) => entry.id)).toEqual([proposal.drafts[1]!.id])
  const duplicate = saveNote(saved.library, {
    ...draft.input,
    deckId: draft.deckId,
    excerpt: draft.excerpt,
  })
  await expect(
    repo.save(duplicate, saved.revision, { consumeCardDraft: draft.id }),
  ).rejects.toThrow('另一个标签页')
  expect((await repo.load()).library.notes).toHaveLength(saved.library.notes.length)
  const before = await repo.getBackup((await repo.listBackups())[0]!.id)
  expect(before).not.toHaveProperty('cardDrafts')
  await repo.save(before, saved.revision)
  expect(await repo.readCardDrafts()).toHaveLength(1)
  await repo.close()
})

it('rolls back the entire received batch when its second draft cannot be stored', async () => {
  const { repo, proposal, context } = await setup()
  const original = IDBObjectStore.prototype.add
  let count = 0
  const fail = vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(function (
    this: IDBObjectStore,
    ...args: Parameters<typeof original>
  ) {
    if (this.name === 'cardDrafts' && ++count === 2)
      throw new DOMException('Synthetic full storage', 'QuotaExceededError')
    return original.apply(this, args)
  })
  try {
    await expect(repo.addCardDrafts(proposal.drafts)).rejects.toMatchObject({
      name: 'QuotaExceededError',
    })
  } finally {
    fail.mockRestore()
  }
  expect(await repo.readCardDrafts()).toEqual([])
  expect(await repo.load()).toEqual(contextWithoutScope(context))
  await repo.addCardDrafts(proposal.drafts)
  expect(await repo.readCardDrafts()).toHaveLength(2)
  await repo.close()
})

it('retains deck identifiers up to the existing note limit', async () => {
  const { repo, proposal } = await setup()
  const draft = { ...proposal.drafts[0]!, deckId: 'd'.repeat(150) }
  await repo.addCardDrafts([draft])
  expect((await repo.readCardDrafts())[0]!.deckId).toBe(draft.deckId)
  await repo.close()
})

it('isolates local databases, enforces capacity across writers, and keeps malformed records intact', async () => {
  const { name, repo, proposal } = await setup()
  const other = createRepository(`other-${crypto.randomUUID()}`)
  await expect(other.addCardDrafts(proposal.drafts)).rejects.toThrow()
  expect(await other.readCardDrafts()).toEqual([])
  await other.close()
  const batch = Array.from({ length: MAX_DRAFTS }, (_, position) => ({
    ...proposal.drafts[0]!,
    id: crypto.randomUUID(),
    position,
  }))
  await repo.addCardDrafts(batch)
  const second = createRepository(name)
  await expect(second.addCardDrafts(proposal.drafts)).rejects.toThrow('50')
  expect(await second.readCardDrafts()).toHaveLength(MAX_DRAFTS)
  await second.close()
  await repo.discardCardDraft(batch[0]!.id)
  await expect(repo.addCardDrafts(proposal.drafts)).rejects.toThrow('50')
  expect(await repo.readCardDrafts()).toHaveLength(MAX_DRAFTS - 1)
  const db = await openDB(name, 9)
  const broken = { ...batch[1]!, version: 99 }
  await db.put('cardDrafts', broken, batch[1]!.id)
  await expect(repo.readCardDrafts()).rejects.toThrow()
  expect(await db.get('cardDrafts', batch[1]!.id)).toEqual(broken)
  db.close()
  await repo.close()
})

it('upgrades normalized v8 storage without changing learning records, revision, media or checkpoints', async () => {
  const name = `draft-upgrade-${crypto.randomUUID()}`,
    library = fixture()
  const old = await openDB(name, 8, {
    upgrade(db) {
      for (const store of [
        'workspace',
        'assets',
        'backups',
        'meta',
        'checkpoints',
        'attemptSummaries',
        ...recordStores,
      ])
        db.createObjectStore(store)
      const history = db.createObjectStore('history')
      history.createIndex('revision', 'revision')
      history.createIndex('store', 'store')
    },
  })
  const tx = old.transaction([...recordStores, 'meta', 'checkpoints'], 'readwrite')
  for (const store of recordStores)
    for (const [position, value] of library[store].entries())
      await tx.objectStore(store).put({ id: value.id, value, position }, value.id)
  await tx.objectStore('meta').put(
    {
      revision: 12,
      counts: Object.fromEntries(recordStores.map((store) => [store, library[store].length])),
    },
    'main',
  )
  await tx.objectStore('checkpoints').put(
    {
      id: 'checkpoint',
      revision: 12,
      createdAt: new Date().toISOString(),
      reason: 'test',
      notes: 1,
      cards: 1,
    },
    'checkpoint',
  )
  await tx.done
  old.close()
  const repo = createRepository(name)
  expect(await repo.load()).toEqual({ library, revision: 12 })
  expect(await repo.readCardDrafts()).toEqual([])
  expect(await repo.getBackup('checkpoint')).toEqual(library)
  await expect(openDB(name, 8)).rejects.toMatchObject({ name: 'VersionError' })
  await repo.close()
})
