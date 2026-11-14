import { createApp, nextTick } from 'vue'
import App from '../src/App.vue'
import '../src/style.css'
import { fixture, now } from '../src/core/test-fixtures'
import { createRepository } from '../src/core/storage'
import { installApplicationState } from '../src/stores'

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
async function until(test: () => boolean) {
  const start = performance.now()
  while (!test()) {
    if (performance.now() - start > 30_000) throw new Error('Review benchmark timed out')
    await frame()
  }
}
async function prepare(cards: number) {
  if (!Number.isInteger(cards) || cards < 100 || cards > 10_000)
    throw new Error('cards must be 100–10000')
  const library = fixture(),
    note = library.notes[0]!,
    card = library.cards[0]!
  library.decks[0]!.newLimit = Math.min(cards, 9999)
  library.decks[0]!.reviewLimit = Math.min(cards, 9999)
  library.notes = Array.from({ length: cards }, (_, i) => ({
    ...note,
    id: `note-${i}`,
    format: 'markdown' as const,
    type: i % 4 === 0 ? ('cloze' as const) : ('basic' as const),
    front:
      i % 4 === 0
        ? `Question ${i}: {{c1::理解}} and {{c1::记忆}}`
        : `Question ${i}: **中文：**说明`,
    back: `Answer ${i}: ${'A short explanation. '.repeat(20)}`,
  }))
  library.cards = library.notes.map((note, i) => ({
    ...card,
    id: `card-${String(i).padStart(5, '0')}`,
    noteId: note.id,
    variant: note.type === 'cloze' ? 'cloze:1' : card.variant,
  }))
  library.reviews = Array.from({ length: cards * 10 }, (_, i) => ({
    id: `review-${i}`,
    cardId: library.cards[i % cards]!.id,
    rating: 3 as const,
    reviewedAt: now.toISOString(),
    nextDue: now.toISOString(),
    studyDay: '2026-01-01',
    kind: 'legacy' as const,
    source: 'normal' as const,
  }))
  const repository = createRepository('repeaty')
  await repository.save(library, 0)
  await repository.close()
  return { cards, reviews: library.reviews.length }
}
async function benchmark(prepared: Awaited<ReturnType<typeof prepare>>) {
  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp(App)
  installApplicationState(app)
  const longTasks: number[] = []
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) longTasks.push(entry.duration)
  })
  observer.observe({ type: 'longtask', buffered: false })
  const start = performance.now()
  app.mount(root)
  await until(() => !!root.querySelector('.deck-review'))
  const startupMs = performance.now() - start
  root.querySelector<HTMLButtonElement>('.deck-review')!.click()
  await until(() => !!root.querySelector('.flashcard'))
  const samples: number[] = []
  for (let i = 0; i < 8; i++) {
    root.querySelector<HTMLButtonElement>('.reveal-action button')!.click()
    await nextTick()
    const button = root.querySelector<HTMLButtonElement>(
      `.grade-button.${i % 2 === 0 ? 'again' : 'good'}`,
    )!
    await until(() => !button.disabled)
    const before = root.querySelector('.flashcard')!.textContent
    const clicked = performance.now()
    button.click()
    await until(
      () =>
        root.querySelector('.flashcard')?.textContent !== before &&
        !!root.querySelector('.reveal-action button'),
    )
    await frame()
    samples.push(performance.now() - clicked)
  }
  observer.disconnect()
  const sorted = [...samples].sort((a, b) => a - b)
  app.unmount()
  root.remove()
  const repository = createRepository('repeaty')
  const saved = await repository.load()
  if (saved.library.reviews.length !== prepared.reviews + 8)
    throw new Error('Lost or duplicate grade')
  await repository.close()
  return {
    ...prepared,
    cpuSlowdown: 4,
    startupMs,
    clickToNextMedianMs: (sorted[3]! + sorted[4]!) / 2,
    clickToNextMaxMs: sorted.at(-1),
    samplesMs: samples,
    longTasks: longTasks.length,
    longestTaskMs: Math.max(0, ...longTasks),
  }
}
Object.assign(window, { prepareReviewBenchmark: prepare, runScaleBenchmark: benchmark })
