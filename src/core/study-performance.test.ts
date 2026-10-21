import 'fake-indexeddb/auto'
import { it, expect } from 'vitest'
import { createCardViewReader, cardViews, saveNote } from './model'
import { fixture, now } from './test-fixtures'
import { reviewCard, undoReview } from './scheduler'
import { createRepository } from './storage'

it('reuses immutable card views and invalidates edited notes, ratings and removed variants', () => {
  const reader = createCardViewReader(),
    library = fixture({ type: 'cloze', front: '{{c1::one}} and {{c2::two}}' })
  library.decks[0]!.burySiblings = false
  const before = reader(library)
  const rated = reviewCard(library, library.cards[0]!.id, 3, now)
  const after = reader(rated)
  expect(after).toEqual(cardViews(rated))
  expect(after[0]).not.toBe(before[0])
  expect(after[1]).toBe(before[1])
  const edited = saveNote(
    rated,
    { ...rated.notes[0]!, front: '{{c1::changed}}' },
    rated.notes[0]!.id,
    true,
    now,
  )
  expect(reader(edited)).toEqual(cardViews(edited))
  expect(reader(edited)[0]!.cloze?.answers).toEqual(['changed'])
  expect(reader(edited)).toHaveLength(1)
})

it('appends review rows durably while rejecting prefix tampering and duplicate IDs; undo retains checkpoints', async () => {
  const repository = createRepository(`review-append-${crypto.randomUUID()}`)
  try {
    const library = fixture()
    await repository.save(library, 0)
    await repository.backupNow(true)
    const first = await repository.save(reviewCard(library, library.cards[0]!.id, 3, now), 1)
    const due = new Date(new Date(first.library.cards[0]!.schedule.due).getTime() + 1000)
    const next = reviewCard(first.library, first.library.cards[0]!.id, 3, due)
    await expect(
      repository.save(
        { ...next, reviews: [...first.library.reviews, first.library.reviews[0]!] },
        2,
      ),
    ).rejects.toThrow('duplicate')
    await expect(
      repository.save(
        { ...next, reviews: [{ ...next.reviews[0]!, cardId: 'missing' }, next.reviews[1]!] },
        2,
      ),
    ).rejects.toThrow()
    expect((await repository.load()).library).toEqual(first.library)
    const saved = await repository.save(next, 2)
    expect(saved.library.reviews).toHaveLength(2)
    await repository.save(undoReview(saved.library), 3)
    expect((await repository.load()).library).toEqual(first.library)
    expect(await repository.getBackup((await repository.listBackups())[0]!.id)).toEqual(library)
  } finally {
    await repository.close()
  }
})
