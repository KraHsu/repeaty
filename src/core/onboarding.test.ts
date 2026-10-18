import 'fake-indexeddb/auto'
import { describe, expect, it, vi } from 'vitest'
import { createRepository } from './storage'
import { initializeWorkspace } from './onboarding'
import { createStarterDeck } from './sample'
import { cardViews, emptyLibrary, librarySchema } from './model'
import { dueCards, reviewCard } from './scheduler'
import { exportArchive, parseArchive } from './archive'
import { setLocale } from '../i18n'
import { fixture } from './test-fixtures'

for (const language of ['zh-CN', 'en'] as const) {
  it(`ships a valid, ordered ${language} deck with real media and independent card schedules`, async () => {
    const now = new Date()
    const { library, assets } = createStarterDeck(language, now)
    expect(librarySchema.parse(library)).toEqual(library)
    expect(library.notes).toHaveLength(24)
    expect(library.cards).toHaveLength(27)
    expect(new Set(library.notes.map((note) => note.type))).toEqual(
      new Set(['basic', 'cloze', 'reversed']),
    )
    expect(new Set(library.notes.map((note) => note.format))).toEqual(
      new Set(['plain', 'markdown']),
    )
    expect(library.reviews).toEqual([])
    expect(
      library.cards.every((card) => card.schedule.state === 0 && card.schedule.reps === 0),
    ).toBe(true)
    const queue = dueCards(library, now)
    expect(queue[0]!.noteId).toBe(library.notes[0]!.id)
    expect(queue).toHaveLength(27)
    const reversed = cardViews(library).filter((card) => card.type === 'reversed')
    const reviewed = reviewCard(library, reversed[0]!.id, 3, now)
    expect(reviewed.cards.find((card) => card.id === reversed[1]!.id)!.schedule.reps).toBe(0)
    const png = new Uint8Array(await assets[0]!.blob.arrayBuffer())
    expect([...png.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
    const wav = new DataView(await assets[1]!.blob.arrayBuffer())
    expect(wav.getUint32(24, true)).toBe(22050)
    expect(wav.getUint32(40, true) + 44).toBe(assets[1]!.blob.size)
    const archive = (await exportArchive(
      library,
      async (id) => assets.find((asset) => asset.meta.id === id)?.blob,
    ))!
    const restored = await parseArchive(archive)
    expect(restored.library).toEqual(library)
    for (const asset of restored.assets)
      expect(await asset.blob.arrayBuffer()).toEqual(
        await assets.find((entry) => entry.meta.id === asset.meta.id)!.blob.arrayBuffer(),
      )
  })
}

describe('first-run initialization', () => {
  it('seeds once, persists media and edits, and respects deliberate deletion', async () => {
    setLocale('en')
    const repository = createRepository(`starter-${crypto.randomUUID()}`)
    try {
      const first = await initializeWorkspace(repository)
      expect(first.library.notes).toHaveLength(24)
      expect(first.revision).toBe(1)
      expect((await repository.getMedia(first.library.media[0]!.id))!.size).toBe(
        first.library.media[0]!.size,
      )
      await repository.save(
        {
          ...first.library,
          notes: first.library.notes.map((note, index) =>
            index === 0 ? { ...note, front: 'My edited question' } : note,
          ),
        },
        first.revision,
      )
      setLocale('zh-CN')
      const next = await initializeWorkspace(repository)
      expect(next.library.decks[0]!.name).toBe('Start here: FSRS & Repeaty')
      expect(next.library.notes[0]!.front).toBe('My edited question')
      await repository.save(emptyLibrary(), next.revision)
      expect((await initializeWorkspace(repository)).library.decks).toEqual([])
    } finally {
      await repository.close()
    }
  })

  it('does not insert anything into an existing library', async () => {
    const library = fixture()
    const repository = { load: vi.fn().mockResolvedValue({ revision: 0, library }), save: vi.fn() }
    expect((await initializeWorkspace(repository)).library).toEqual(library)
    expect(repository.save).not.toHaveBeenCalled()
  })

  it('two first-time tabs converge on one committed deck', async () => {
    const name = `starter-${crypto.randomUUID()}`
    const left = createRepository(name),
      right = createRepository(name)
    try {
      const [a, b] = await Promise.all([initializeWorkspace(left), initializeWorkspace(right)])
      expect(a).toEqual(b)
      expect(a.library.decks).toHaveLength(1)
      expect(a.library.media).toHaveLength(2)
    } finally {
      await left.close()
      await right.close()
    }
  })

  it('surfaces a failed first save instead of pretending initialization succeeded', async () => {
    const failure = new DOMException('Storage is full', 'QuotaExceededError')
    const repository = {
      load: vi.fn().mockResolvedValue({ revision: 0, library: emptyLibrary() }),
      save: vi.fn().mockRejectedValue(failure),
    }
    await expect(initializeWorkspace(repository)).rejects.toBe(failure)
  })
})
