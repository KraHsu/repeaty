import 'fake-indexeddb/auto'
import { afterEach, expect, it, vi } from 'vitest'
import { createRepository } from './storage'
import { fixture, now } from './test-fixtures'
import { cardViews, type Library } from './model'
import { noteLifecycle } from '../desktop/retirement'
import { reviewCard } from './scheduler'
import { prepareMedia } from './media'
import { addSource, prepareSource, removeSource, sourceExcerpt } from './sources'

const repositories: ReturnType<typeof createRepository>[] = []
function repository(name = `retired-${crypto.randomUUID()}`) {
  const result = createRepository(name, undefined, { compactHistory: true })
  repositories.push(result)
  return result
}
function sample() {
  const asset = prepareMedia(new File(['original-image'], 'original.png', { type: 'image/png' }))
  let library = fixture({
    type: 'plugin',
    plugin: {
      id: 'visual-occlusion',
      version: 1,
      data: { regions: [{ id: 'a' }, { id: 'b' }] },
      variants: ['a', 'b'],
    },
  })
  library.decks[0]!.burySiblings = false
  library.media = [asset.meta]
  library.notes[0]!.backMedia = [asset.meta.id]
  library = reviewCard(library, library.cards[0]!.id, 3, now)
  const card = cardViews(library)[0]!
  library.practices = [
    {
      id: 'practice',
      cardId: card.id,
      contentRevision: 'original',
      question: { front: card.front, back: card.back, format: card.format, plugin: card.plugin! },
      startedAt: now.toISOString(),
    },
  ]
  library.attempts = [
    {
      id: 'attempt',
      practiceId: 'practice',
      submittedAt: now.toISOString(),
      updatedAt: now.toISOString(),
      language: 'text',
      code: 'complete original submission\n'.repeat(1000),
      elapsedMs: 100,
      status: 'failed',
    },
  ]
  return { library, asset }
}
async function reduce(
  repo: ReturnType<typeof createRepository>,
  library: Library,
  revision: number,
) {
  const note = library.notes[0]!
  const next = noteLifecycle(
    library,
    { ...note, backMedia: [], plugin: { ...note.plugin!, variants: ['b'] } },
    note.id,
    await repo.retiredNote(note.id),
    true,
  ).library
  return repo.save(next, revision, { reason: '编辑笔记前' })
}
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(repositories.splice(0).map((repo) => repo.close()))
})

it('rejects deleting a material still referenced by a retired region and preserves the original snapshot', async () => {
  const repo = repository(),
    sampleData = sample(),
    text = 'immutable source material'
  const prepared = prepareSource({ title: 'Source', url: '', format: 'plain', content: text }, now)
  const library = addSource(sampleData.library, prepared.source, prepared.asset)
  library.notes[0]!.excerpt = sourceExcerpt(prepared.source, text, 0, 9)
  const saved = await repo.save(library, 0, { assets: [sampleData.asset, prepared.asset] }),
    reduced = await reduce(repo, saved.library, 1)
  await expect(repo.save(removeSource(reduced.library, prepared.source.id), 2)).rejects.toThrow(
    '退役卡片引用',
  )
  expect((await repo.load()).revision).toBe(2)
  expect((await repo.load()).library.sources).toEqual(reduced.library.sources)
  expect((await repo.retiredNote(library.notes[0]!.id)).attempts).toEqual(library.attempts)
})

it('retires a stable plugin region and restores its exact ID, schedule, full history and media after reopen', async () => {
  const name = `retired-${crypto.randomUUID()}`,
    repo = repository(name),
    { library, asset } = sample()
  const saved = await repo.save(library, 0, { assets: [asset] })
  expect(saved.library.attempts[0]?.code).toBeUndefined()
  const reduced = await reduce(repo, saved.library, 1)
  expect(reduced.library.cards.map((card) => card.variant)).toEqual(['plugin:b'])
  expect(reduced.library.attempts).toEqual([])
  expect((await repo.retiredNote(library.notes[0]!.id)).attempts).toEqual(library.attempts)
  await repo.close()
  const reopened = repository(name),
    snapshot = await reopened.load(),
    retired = await reopened.retiredNote(library.notes[0]!.id)
  expect(retired.cards).toEqual([library.cards[0]])
  expect(retired.reviews).toEqual(library.reviews)
  expect(await (await reopened.getMedia(asset.meta.id))?.text()).toBe('original-image')
  const restored = noteLifecycle(
    snapshot.library,
    library.notes[0]!,
    library.notes[0]!.id,
    retired,
  ).library
  await reopened.save(restored, snapshot.revision)
  const full = await reopened.completeLibrary()
  expect(full.cards.find((card) => card.id === library.cards[0]!.id)).toEqual(library.cards[0])
  expect(full.attempts).toEqual(library.attempts)
  expect(full.practices).toEqual(library.practices)
  expect(full.reviews).toEqual(library.reviews)
  expect(await reopened.retiredNotes()).toEqual([])
})

it('reconstructs the retired set at a checkpoint and restores it atomically with the active library', async () => {
  const repo = repository(),
    { library, asset } = sample()
  const saved = await repo.save(library, 0, { assets: [asset] }),
    reduced = await reduce(repo, saved.library, 1)
  await repo.backupNow(true)
  const checkpoint = (await repo.listBackups()).find((entry) => entry.revision === 2)!
  const archive = await repo.retiredNotes(),
    restored = noteLifecycle(
      reduced.library,
      library.notes[0]!,
      library.notes[0]!.id,
      archive[0],
    ).library
  await repo.save(restored, 2)
  expect(await repo.retiredNotes()).toEqual([])
  expect((await repo.retiredNotes(checkpoint.id))[0]?.attempts).toEqual(library.attempts)
  const old = await repo.getBackup(checkpoint.id),
    retired = await repo.retiredNotes(checkpoint.id)
  await repo.save(old, 3, { retired })
  expect((await repo.retiredNotes())[0]?.cards[0]).toEqual(library.cards[0])
  expect((await repo.load()).library.cards).toEqual(reduced.library.cards)
})

it('imports archived-only media and full attempts, and rolls back a malformed retired import', async () => {
  const source = repository(),
    { library, asset } = sample(),
    saved = await source.save(library, 0, { assets: [asset] }),
    reduced = await reduce(source, saved.library, 1)
  const retired = await source.retiredNotes(),
    target = repository()
  await target.save(reduced.library, 0, { retired, assets: [asset] })
  expect((await target.retiredNotes())[0]?.attempts).toEqual(library.attempts)
  expect(await (await target.getMedia(asset.meta.id))?.text()).toBe('original-image')
  const bad = structuredClone(retired)
  delete bad[0]!.attempts[0]!.code
  await expect(target.save(reduced.library, 1, { retired: bad })).rejects.toThrow()
  expect((await target.load()).revision).toBe(1)
  expect((await target.retiredNotes())[0]?.attempts).toEqual(library.attempts)
})

it('ordinary grading does not read any retired record or full attempt body', async () => {
  const repo = repository(),
    { library, asset } = sample(),
    saved = await repo.save(library, 0, { assets: [asset] }),
    reduced = await reduce(repo, saved.library, 1)
  const reads: string[] = []
  for (const method of ['get', 'getAll', 'openCursor'] as const) {
    const original = IDBObjectStore.prototype[method]
    vi.spyOn(IDBObjectStore.prototype, method).mockImplementation(function (
      this: IDBObjectStore,
      ...args: unknown[]
    ) {
      reads.push(this.name)
      return Reflect.apply(original, this, args)
    })
  }
  await repo.save(
    reviewCard(reduced.library, reduced.library.cards[0]!.id, 3, new Date(now.getTime() + 5000)),
    2,
  )
  expect(reads).not.toContain('retiredNotes')
  expect(reads).not.toContain('retiredChanges')
  expect(reads).not.toContain('attempts')
})
