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
async function prepare() {
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
    source: 'normal' as const,
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
  const name = `repeaty-history-benchmark-${crypto.randomUUID()}`
  const repo = createRepository(name, undefined, { compactHistory: true })
  const start = performance.now()
  await repo.save(library, 0)
  const initialSaveMs = performance.now() - start
  console.log(`benchmark: initialSaveMs ${initialSaveMs.toFixed(1)} ms`)
  await repo.close()
  return {
    name,
    cards,
    practices,
    attempts: practices * attemptsPerPractice,
    reviews: 100_000,
    codeBytes,
    initialSaveMs,
  }
}
async function benchmark(prepared: Awaited<ReturnType<typeof prepare>>) {
  const times: Record<string, number> = { initialSaveMs: prepared.initialSaveMs }
  const measure = async <T>(key: string, action: () => T | Promise<T>): Promise<T> => {
    const start = performance.now()
    const result = await action()
    times[key] = performance.now() - start
    console.log(`benchmark: ${key} ${times[key].toFixed(1)} ms`)
    return result
  }
  const repo = createRepository(prepared.name, undefined, { compactHistory: true })
  let saved = await measure('loadMs', () => repo.load())
  ;(globalThis as { gc?: () => void }).gc?.()
  const heap = performance as Performance & { memory?: { usedJSHeapSize: number } }
  const loadedHeapMiB = heap.memory ? heap.memory.usedJSHeapSize / 1024 / 1024 : undefined
  const loadedCodeCharacters = saved.library.attempts.reduce(
    (sum, entry) => sum + (entry.code?.length ?? 0),
    0,
  )
  const current = shallowRef(saved.library)
  const host = document.createElement('main')
  document.body.append(host)
  const app = createApp({
    render: () =>
      h(PracticeHistoryPanel, {
        library: current.value,
        getAttempt: (id: string, signal?: AbortSignal) =>
          repo.getAttempt(id, saved.revision, signal),
      }),
  })
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
  await measure('expandCodeMs', async () => {
    host.querySelector<HTMLDetailsElement>('.attempt-history')!.open = true
    for (let i = 0; i < 60; i++) {
      await tick()
      if (host.querySelector('.attempt-code code')) return
    }
    throw new Error('Code did not load')
  })
  const practice: Practice = {
    ...saved.library.practices[0]!,
    id: 'benchmark-active',
    completedAt: undefined,
    completion: undefined,
  }
  const attempt: Attempt = {
    ...saved.library.attempts[0]!,
    code: '# saved solution\n'
      .repeat(Math.ceil(prepared.codeBytes / 17))
      .slice(0, prepared.codeBytes),
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
      result:
        status === 'completed'
          ? {
              outcome: 'accepted' as const,
              status: '通过',
              runtime: '1 ms',
              memory: '10 MB',
              detail: '',
            }
          : undefined,
    }
    saved = await measure(`${status}SaveMs`, async () => {
      let current = saved.library
      const previous = current.attempts.find((entry) => entry.id === value.id)
      if (previous && typeof previous.code !== 'string') {
        const full = await repo.getAttempt(previous.id, saved.revision)
        current = {
          ...current,
          attempts: current.attempts.map((entry) => (entry.id === full.id ? full : entry)),
        }
      }
      return repo.save(recordAttempt(current, practice, value), saved.revision)
    })
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
      readAttempts: (offset) => repo.readAttemptBatch(offset, saved.revision),
    }),
  )
  const { name: _name, initialSaveMs: _initialSave, ...size } = prepared
  const result = {
    ...size,
    initialCodeNodes,
    loadedCodeCharacters,
    archiveBytes,
    loadedHeapMiB,
    ...times,
  }
  app.unmount()
  host.remove()
  await repo.close()
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(prepared.name)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
  return result
}
;(window as unknown as { runScaleBenchmark: typeof benchmark }).runScaleBenchmark = benchmark
;(window as unknown as { prepareHistoryBenchmark: typeof prepare }).prepareHistoryBenchmark =
  prepare
