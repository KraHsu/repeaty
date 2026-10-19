import { fixture, now } from '../src/core/test-fixtures'
import { createRepository } from '../src/core/storage'
import { reviewCard } from '../src/core/scheduler'

export async function benchmark(noteCount = 10_000, reviewCount = 100_000) {
  const library = fixture(),
    note = library.notes[0]!,
    card = library.cards[0]!
  library.notes = Array.from({ length: noteCount }, (_, i) => ({
    ...note,
    id: `note-${i}`,
    front: `Question ${i}`,
    back: `Answer ${i}`,
  }))
  library.cards = library.notes.map((note, i) => ({ ...card, id: `card-${i}`, noteId: note.id }))
  library.reviews = Array.from({ length: reviewCount }, (_, i) => ({
    id: `review-${i}`,
    cardId: `card-${i % noteCount}`,
    rating: 3 as const,
    reviewedAt: now.toISOString(),
    nextDue: now.toISOString(),
    studyDay: '2026-01-01',
    kind: 'legacy' as const,
    source: 'normal' as const,
  }))
  const name = `repeaty-benchmark-${crypto.randomUUID()}`,
    repo = createRepository(name)
  const times: Record<string, number> = {}
  let start = performance.now()
  let saved = await repo.save(library, 0)
  times.initialSaveMs = performance.now() - start
  start = performance.now()
  saved = await repo.load()
  times.loadMs = performance.now() - start
  start = performance.now()
  await repo.backupNow(true)
  times.checkpointMs = performance.now() - start
  start = performance.now()
  const page = await repo.queryCards({ query: '', state: 'all', deckId: '' }, 100, now, false)
  times.pageMs = performance.now() - start
  if (page.cards.length !== 50 || page.total !== noteCount) throw new Error('Pagination mismatch')
  start = performance.now()
  await repo.queryCards({ query: 'Question 999', state: 'all', deckId: '' }, 1, now, false)
  times.searchMs = performance.now() - start
  const heap = performance as Performance & { memory?: { usedJSHeapSize: number } }
  if (heap.memory) times.loadedHeapMiB = heap.memory.usedJSHeapSize / 1024 / 1024
  const reviewStart = performance.now()
  const reviewed = reviewCard(saved.library, saved.library.cards[0]!.id, 3, new Date(), 'filtered')
  start = performance.now()
  saved = await repo.save(reviewed, saved.revision)
  times.reviewSaveMs = performance.now() - start
  times.reviewTotalMs = performance.now() - reviewStart
  if (saved.library.reviews.length !== reviewCount + 1) throw new Error('Lost review')
  await repo.close()
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
  return { notes: noteCount, cards: noteCount, reviews: reviewCount, ...times }
}
;(window as unknown as { runScaleBenchmark: typeof benchmark }).runScaleBenchmark = benchmark
