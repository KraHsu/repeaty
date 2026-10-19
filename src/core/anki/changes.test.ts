import 'fake-indexeddb/auto'
import { beforeAll, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import initSqlJs from 'sql.js'
import { parseAnkiPackage } from './package'
import { compareAnkiImport, ankiSelectionSummary } from './changes'
import { applyAnkiImportPlan, prepareAnkiImport } from './import'
import { ankiNoteId, type AnkiPackage } from './types'
import { fixture, now } from '../test-fixtures'
import { librarySchema, type Library } from '../model'
import { reviewCard } from '../scheduler'
import { practiceSchema, attemptSchema } from '../practice-data'
import { createRepository } from '../storage'

let original: AnkiPackage
beforeAll(async () => {
  original = await parseAnkiPackage(
    new Blob([await readFile('tests/fixtures/anki/modern.apkg')]),
    await initSqlJs(),
  )
})
function incoming(): AnkiPackage {
  const ids = new Map(original.assets.map((asset) => [asset.meta.id, crypto.randomUUID()]))
  return {
    ...original,
    notes: original.notes.map((note) => ({
      ...note,
      input: {
        ...note.input,
        tags: [...note.input.tags],
        frontMedia: note.input.frontMedia.map((id) => ids.get(id)!),
        backMedia: note.input.backMedia.map((id) => ids.get(id)!),
      },
    })),
    assets: original.assets.map((asset) => ({
      ...asset,
      meta: { ...asset.meta, id: ids.get(asset.meta.id)! },
    })),
  }
}
function setup() {
  const { library, assets } = prepareAnkiImport(fixture(), original, 'deck', now)
  const blobs = new Map(assets.map((asset) => [asset.meta.id, asset.blob]))
  return { library, getMedia: async (id: string) => blobs.get(id) }
}
const id = (guid: string) => ankiNoteId(`rpt-${guid}`)

it('matches content across random media IDs and tag order without writing a duplicate', async () => {
  const { library, getMedia } = setup()
  const data = incoming()
  data.notes.forEach((note) => note.input.tags.reverse())
  const plan = await compareAnkiImport(library, data, getMedia)
  expect(plan.changes.map((change) => change.status)).toEqual(['same', 'same', 'same', 'same'])
  expect(ankiSelectionSummary(plan, [])).toMatchObject({
    addedNotes: 0,
    updatedNotes: 0,
    newMedia: 0,
  })
  expect(
    applyAnkiImportPlan(library, plan, { ids: [], confirmCardChanges: false }, 'deck').library,
  ).toBe(library)
})

it('updates only selected notes, retains their original deck, card IDs, FSRS and history', async () => {
  const source = setup()
  let library = reviewCard(
    source.library,
    source.library.cards.find((card) => card.noteId === id('basic'))!.id,
    3,
    now,
  )
  library = {
    ...library,
    decks: [...library.decks, { ...library.decks[0]!, id: 'other', name: 'Other' }],
  }
  const data = incoming()
  data.notes.find((note) => note.id === id('basic'))!.input.back = 'Updated answer'
  data.notes.find((note) => note.id === id('safe'))!.input.front = 'Keep the local version'
  const plan = await compareAnkiImport(library, data, source.getMedia)
  expect(
    plan.changes.filter((entry) => entry.status === 'changed').map((entry) => entry.incoming.id),
  ).toEqual([id('basic'), id('safe')])
  const next = applyAnkiImportPlan(
    library,
    plan,
    { ids: [id('basic')], confirmCardChanges: false },
    'other',
    new Date(now.getTime() + 1000),
  )
  expect(next.library.notes.find((note) => note.id === id('basic'))).toMatchObject({
    back: 'Updated answer',
    deckId: 'deck',
    createdAt: now.toISOString(),
  })
  expect(next.library.notes.find((note) => note.id === id('safe'))).toBe(
    library.notes.find((note) => note.id === id('safe')),
  )
  expect(next.library.cards).toEqual(library.cards)
  expect(next.library.cards.every((card, i) => card === library.cards[i])).toBe(true)
  expect(next.library.reviews).toBe(library.reviews)
  expect(next.assets).toHaveLength(0)
  librarySchema.parse(next.library)
})

it('detects changed bytes under the same filename and keeps shared original media', async () => {
  const { library, getMedia } = setup()
  const data = incoming()
  const audio = data.assets.find((asset) => asset.meta.name === 'voice.wav')!
  const bytes = new Uint8Array(await audio.blob.arrayBuffer())
  bytes[bytes.length - 1] = 7
  audio.blob = new Blob([bytes], { type: audio.meta.type })
  const plan = await compareAnkiImport(library, data, getMedia)
  const basic = plan.changes.find((entry) => entry.incoming.id === id('basic'))!
  expect(basic.differences).toEqual(['backMedia'])
  expect(ankiSelectionSummary(plan, [id('basic')]).newMedia).toBe(1)
  const next = applyAnkiImportPlan(
    library,
    plan,
    { ids: [id('basic')], confirmCardChanges: false },
    'deck',
  )
  expect(next.assets.map((asset) => asset.meta.id)).toEqual([audio.meta.id])
  expect(next.library.media).toHaveLength(2)
  expect(next.library.notes.find((note) => note.id === id('basic'))!.frontMedia).toEqual(
    library.notes.find((note) => note.id === id('basic'))!.frontMedia,
  )
  librarySchema.parse(next.library)
})

it('requires confirmation for new and removed variants and removes only their history', async () => {
  const source = setup()
  const reverse = source.library.cards.find(
    (card) => card.noteId === id('reverse') && card.variant === 'reverse',
  )!
  let library = reviewCard(source.library, reverse.id, 3, now)
  const practice = practiceSchema.parse({
    id: 'practice',
    cardId: reverse.id,
    contentRevision: 'old',
    question: {
      front: 'old',
      back: '',
      format: 'plain',
      plugin: { id: 'leetcode', version: 1, data: {} },
    },
    startedAt: now.toISOString(),
  })
  const attempt = attemptSchema.parse({
    id: 'attempt',
    practiceId: practice.id,
    submittedAt: now.toISOString(),
    updatedAt: now.toISOString(),
    language: 'python3',
    code: 'answer',
    elapsedMs: 1,
    status: 'unknown',
  })
  library = { ...library, practices: [practice], attempts: [attempt] }
  const data = incoming()
  data.notes.find((note) => note.id === id('reverse'))!.input.type = 'basic'
  data.notes.find((note) => note.id === id('cloze'))!.input.front =
    'The {{c1::capital}} of France is {{c3::Paris}}.'
  const plan = await compareAnkiImport(library, data, source.getMedia)
  const ids = [id('reverse'), id('cloze')]
  const summary = ankiSelectionSummary(plan, ids)
  expect(summary.addedCards).toBe(1)
  expect(summary.removedCards).toHaveLength(2)
  expect(summary.removedCards.find((card) => card.id === reverse.id)).toMatchObject({
    reviews: 1,
    practices: 1,
    attempts: 1,
  })
  expect(() =>
    applyAnkiImportPlan(library, plan, { ids, confirmCardChanges: false }, 'deck'),
  ).toThrow('请先确认')
  const next = applyAnkiImportPlan(library, plan, { ids, confirmCardChanges: true }, 'deck', now)
  expect(next.library.cards).toHaveLength(library.cards.length - 1)
  expect(next.library.reviews).toEqual([])
  expect(next.library.practices).toEqual([])
  expect(next.library.attempts).toEqual([])
  const unchanged = library.cards.filter(
    (card) => !summary.removedCards.some((removed) => removed.id === card.id),
  )
  for (const card of unchanged)
    expect(next.library.cards.find((entry) => entry.id === card.id)).toBe(card)
  expect(next.library.cards.find((card) => card.variant === 'cloze:3')!.schedule.reps).toBe(0)
  librarySchema.parse(next.library)
})

it('requires confirmation when converting a basic note to reversed even without removing a card', async () => {
  const { library, getMedia } = setup()
  const data = incoming()
  data.notes.find((note) => note.id === id('basic'))!.input.type = 'reversed'
  const plan = await compareAnkiImport(library, data, getMedia)
  expect(() =>
    applyAnkiImportPlan(library, plan, { ids: [id('basic')], confirmCardChanges: false }, 'deck'),
  ).toThrow('请先确认')
  const next = applyAnkiImportPlan(
    library,
    plan,
    { ids: [id('basic')], confirmCardChanges: true },
    'deck',
    now,
  )
  expect(next.library.cards).toHaveLength(library.cards.length + 1)
})

it('disables unreadable comparisons, allows independent notes and cancels during media reads', async () => {
  const { library } = setup()
  const data = incoming()
  const plan = await compareAnkiImport(library, data, async () => undefined)
  expect(plan.changes.find((entry) => entry.incoming.id === id('basic'))!.status).toBe(
    'unavailable',
  )
  expect(plan.changes.find((entry) => entry.incoming.id === id('safe'))!.status).toBe('same')
  expect(() =>
    applyAnkiImportPlan(library, plan, { ids: [id('basic')], confirmCardChanges: true }, 'deck'),
  ).toThrow('Anki 文件损坏')
  const controller = new AbortController()
  await expect(
    compareAnkiImport(
      library,
      data,
      async () => {
        controller.abort()
        return undefined
      },
      controller.signal,
    ),
  ).rejects.toMatchObject({ name: 'AbortError' })
})

it('rejects stale previews, unknown selections and duplicate identities without mutating the library', async () => {
  const { library, getMedia } = setup()
  const data = incoming()
  const plan = await compareAnkiImport(library, data, getMedia)
  expect(() =>
    applyAnkiImportPlan({ ...library }, plan, { ids: [], confirmCardChanges: true }, 'deck'),
  ).toThrow('学习库已变化')
  expect(() =>
    applyAnkiImportPlan(library, plan, { ids: ['unknown'], confirmCardChanges: true }, 'deck'),
  ).toThrow()
  data.notes.push(data.notes[0]!)
  await expect(compareAnkiImport(library, data, getMedia)).rejects.toThrow('Anki 文件损坏')
})

it('commits a mixed batch atomically and restores original attachment bytes from the pre-import snapshot', async () => {
  const { library } = setup()
  const repo = createRepository(`anki-updates-${crypto.randomUUID()}`)
  await repo.load()
  const first = await repo.save(library, 0, { assets: original.assets })
  const data = incoming()
  const basic = data.notes.find((note) => note.id === id('basic'))!
  basic.input.front = 'Changed question'
  basic.input.frontMedia = []
  basic.input.backMedia = []
  const extra = { ...data.notes[1]!, guid: 'rpt-new', id: id('new') }
  data.notes.push(extra)
  const plan = await compareAnkiImport(first.library, data, (id) => repo.getMedia(id))
  const next = applyAnkiImportPlan(
    first.library,
    plan,
    { ids: [id('basic'), id('new')], confirmCardChanges: false },
    'deck',
    now,
  )
  const saved = await repo.save(next.library, first.revision, {
    assets: next.assets,
    reason: '导入笔记前',
  })
  expect(saved.library.media).toEqual([])
  expect(saved.library.notes).toHaveLength(library.notes.length + 1)
  const snapshot = (await repo.listBackups()).find((entry) => entry.reason === '导入笔记前')!
  const before = await repo.getBackup(snapshot.id)
  expect(before.notes.find((note) => note.id === id('basic'))!.front).toBe(
    library.notes.find((note) => note.id === id('basic'))!.front,
  )
  for (const asset of original.assets)
    expect(new Uint8Array(await (await repo.getMedia(asset.meta.id))!.arrayBuffer())).toEqual(
      new Uint8Array(await asset.blob.arrayBuffer()),
    )
  await repo.save(before, saved.revision)
  librarySchema.parse((await repo.load()).library as Library)
  await repo.close()
})
