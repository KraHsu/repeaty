import { createApp, nextTick, h, shallowRef } from 'vue'
import { fixture, now } from '../src/core/test-fixtures'
import { createRepository } from '../src/core/storage'
import { recordAttempt } from '../src/core/practice'
import { reviewCard } from '../src/core/scheduler'
import { exportArchive } from '../src/core/archive'
import type { Attempt, Practice } from '../src/core/practice-data'
import PracticeHistoryPanel from '../src/components/PracticeHistoryPanel.vue'

const tick = async () => {
  await nextTick()
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
}
async function benchmark() {
  const cards = 10_000,
    practices = 20_000,
    attemptsPerPractice = 3,
    codeBytes = 2048
  const library = fixture(),
    note = library.notes[0]!,
    card = library.cards[0]!
  const content = `<p>${'Read the input and return the answer. '.repeat(60)}</p>`
  library.notes = Array.from({ length: cards }, (_, i) => ({
    ...note,
    id: `note-${i}`,
    type: 'plugin' as const,
    front: `Problem ${i}`,
    plugin: {
      id: 'leetcode',
      version: 1,
      data: { site: 'leetcode.cn', slug: `problem-${i}`, content },
    },
  }))
  library.cards = library.notes.map((note, i) => ({ ...card, id: `card-${i}`, noteId: note.id }))
  library.reviews = Array.from({ length: 100_000 }, (_, i) => ({
    id: `review-${i}`,
    cardId: `card-${i % cards}`,
    rating: 3 as const,
    reviewedAt: now.toISOString(),
    nextDue: now.toISOString(),
    studyDay: '2026-10-17',
    kind: 'legacy' as const,
  }))
  library.practices = Array.from({ length: practices }, (_, i) => {
    const note = library.notes[i % cards]!
    const date = new Date(now.getTime() + i * 1000).toISOString()
    return {
      id: `practice-${i}`,
      cardId: `card-${i % cards}`,
      contentRevision: 'benchmark',
      question: { front: note.front, back: '', format: note.format, plugin: note.plugin! },
      startedAt: date,
      completedAt: date,
      completion: 'practice',
    }
  })
  library.attempts = library.practices.flatMap((practice, i) =>
    Array.from({ length: attemptsPerPractice }, (_, j): Attempt => ({
      id: `attempt-${i}-${j}`,
      practiceId: practice.id,
      submittedAt: practice.startedAt,
      updatedAt: practice.startedAt,
      language: 'python3',
      code: `# attempt ${i}-${j}\n${'# saved solution\n'.repeat(Math.ceil(codeBytes / 17))}`.slice(
        0,
        codeBytes,
      ),
      elapsedMs: 60_000,
      status: 'completed',
      submissionId: String(i * attemptsPerPractice + j + 1),
      result: {
        outcome: j === attemptsPerPractice - 1 ? 'accepted' : 'rejected',
        status: j === attemptsPerPractice - 1 ? '通过' : '答案错误',
        runtime: '1 ms',
        memory: '10 MB',
        detail: j === attemptsPerPractice - 1 ? '' : 'Expected 1, received 0',
      },
    })),
  )
  const times: Record<string, number> = {}
  const measure = async <T>(key: string, action: () => T | Promise<T>): Promise<T> => {
    const start = performance.now()
    const result = await action()
    times[key] = performance.now() - start
    console.log(`benchmark: ${key} ${times[key].toFixed(1)} ms`)
    return result
  }
  const name = `repeaty-history-benchmark-${crypto.randomUUID()}`
  let repo = createRepository(name)
  let saved = await measure('initialSaveMs', () => repo.save(library, 0))
  await repo.close()
  repo = createRepository(name)
  saved = await measure('loadMs', () => repo.load())
  const current = shallowRef(saved.library)
  const host = document.createElement('main')
  document.body.append(host)
  const app = createApp({ render: () => h(PracticeHistoryPanel, { library: current.value }) })
  await measure('historyMountMs', async () => {
    app.mount(host)
    await tick()
  })
  const initialCodeNodes = host.querySelectorAll('.attempt-code').length
  if (host.querySelectorAll('.practice-history').length !== 20)
    throw new Error('History pagination mismatch')
  const search = host.querySelector<HTMLInputElement>('.search-field input')!
  await measure('historySearchMs', async () => {
    search.value = 'Problem 999'
    search.dispatchEvent(new Event('input', { bubbles: true }))
    await tick()
  })
  await measure('historyResetMs', async () => {
    search.value = ''
    search.dispatchEvent(new Event('input', { bubbles: true }))
    await tick()
  })
  const practice: Practice = {
    ...library.practices[0]!,
    id: 'benchmark-active',
    completedAt: undefined,
    completion: undefined,
  }
  const attempt: Attempt = {
    ...library.attempts[0]!,
    id: 'benchmark-submit',
    practiceId: practice.id,
    status: 'submitting',
    submissionId: undefined,
    result: undefined,
  }
  for (const status of ['submitting', 'pending', 'completed'] as const) {
    const value = {
      ...attempt,
      status,
      submissionId: status === 'submitting' ? undefined : '999999999',
      result: status === 'completed' ? library.attempts[2]!.result : undefined,
    }
    saved = await measure(`${status}SaveMs`, () =>
      repo.save(recordAttempt(saved.library, practice, value), saved.revision),
    )
  }
  saved = await measure('ratingSaveMs', () =>
    repo.save(
      reviewCard(saved.library, 'card-0', 3, now, 'filtered', undefined, undefined, practice.id),
      saved.revision,
    ),
  )
  current.value = saved.library
  await tick()
  await measure('checkpointMs', () => repo.backupNow(true))
  let archiveBytes = 0
  await measure('archiveMs', () =>
    exportArchive(saved.library, (id) => repo.getMedia(id), {
      writable: new WritableStream({
        write: (bytes) => {
          archiveBytes += bytes.byteLength
        },
      }),
    }),
  )
  const heap = performance as Performance & { memory?: { usedJSHeapSize: number } }
  const result = {
    cards,
    reviews: library.reviews.length,
    practices,
    attempts: practices * attemptsPerPractice,
    codeBytes,
    initialCodeNodes,
    archiveBytes,
    // Includes the generated fixture and temporary allocations; not an idle app measurement.
    benchmarkHeapMiB: heap.memory ? heap.memory.usedJSHeapSize / 1024 / 1024 : undefined,
    ...times,
  }
  app.unmount()
  host.remove()
  await repo.close()
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
  return result
}
;(window as unknown as { runScaleBenchmark: typeof benchmark }).runScaleBenchmark = benchmark
