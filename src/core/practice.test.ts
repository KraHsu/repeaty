import 'fake-indexeddb/auto'
import { expect, it } from 'vitest'
import { fixture, now } from './test-fixtures'
import { recordAttempt, finishPractice, practiceContentRevision } from './practice'
import { attemptSchema, practiceSchema } from './practice-data'
import { dailyUsage, reviewCard, undoReview } from './scheduler'
import { librarySchema, migrateLibrary, removeNotes } from './model'
import { createRepository } from './storage'
import { exportArchive, parseArchive } from './archive'
import { exportBackup, parseBackup } from './backups'

function example() {
  const plugin = { id: 'leetcode', version: 1, data: { slug: 'test-problem' } }
  const library = fixture({ type: 'plugin', plugin })
  const practice = practiceSchema.parse({
    id: 'practice',
    cardId: library.cards[0]!.id,
    contentRevision: 'sha256',
    question: { front: 'Problem', back: '', format: 'plain', plugin },
    startedAt: now.toISOString(),
  })
  const attempt = attemptSchema.parse({
    id: 'attempt',
    practiceId: practice.id,
    submittedAt: now.toISOString(),
    updatedAt: now.toISOString(),
    language: 'python3',
    code: 'return 0',
    elapsedMs: 1000,
    status: 'submitting',
  })
  const pending = { ...attempt, status: 'pending' as const, submissionId: '123' }
  const completed = {
    ...pending,
    status: 'completed' as const,
    result: {
      outcome: 'rejected' as const,
      status: '答案错误',
      runtime: '',
      memory: '',
      detail: 'input 1',
    },
  }
  return { library, practice, attempt, pending, completed }
}

it('keeps content identity stable when SQLite or backups reorder JSON object keys', async () => {
  const plugin = { id: 'leetcode', version: 1, data: { site: 'leetcode.cn', slug: 'problem' } }
  const card = { front: 'Problem', back: '', plugin }
  const reordered = {
    ...card,
    plugin: { data: { slug: 'problem', site: 'leetcode.cn' }, version: 1, id: 'leetcode' },
  }
  expect(await practiceContentRevision(card)).toBe(await practiceContentRevision(reordered))
  expect(await practiceContentRevision(card)).not.toBe(
    await practiceContentRevision({ ...card, front: 'Changed' }),
  )
})

it('keeps multiple submissions, rejects mutated retries and cannot rate pending code', () => {
  const { library, practice, attempt, pending, completed } = example()
  let next = recordAttempt(library, practice, attempt)
  expect(recordAttempt(next, practice, attempt)).toBe(next)
  const revealed = recordAttempt(next, { ...practice, answerSeen: true }, attempt)
  expect(revealed.practices[0]!.answerSeen).toBe(true)
  expect(recordAttempt(revealed, practice, pending).practices[0]!.answerSeen).toBe(true)
  expect(() => recordAttempt(next, practice, { ...pending, code: 'different' })).toThrow()
  next = recordAttempt(next, practice, pending)
  expect(() =>
    reviewCard(next, practice.cardId, 1, now, 'normal', undefined, undefined, practice.id),
  ).toThrow()
  next = recordAttempt(next, practice, completed)
  expect(() => recordAttempt(next, practice, pending)).toThrow()
  const second = { ...attempt, id: 'second', code: 'return value' }
  next = recordAttempt(next, practice, second)
  next = recordAttempt(next, practice, { ...second, status: 'pending', submissionId: '124' })
  next = recordAttempt(next, practice, {
    ...second,
    status: 'completed',
    submissionId: '124',
    result: { ...completed.result, outcome: 'accepted', status: '通过' },
  })
  expect(next.attempts.map((entry) => entry.code)).toEqual(['return 0', 'return value'])
  const reviewed = reviewCard(
    next,
    practice.cardId,
    3,
    now,
    'normal',
    undefined,
    undefined,
    practice.id,
  )
  expect(reviewed.reviews).toHaveLength(1)
  expect(reviewed.practices[0]!.reviewId).toBe(reviewed.reviews[0]!.id)
  expect(
    reviewCard(reviewed, practice.cardId, 3, now, 'normal', undefined, undefined, practice.id),
  ).toBe(reviewed)
  const undone = undoReview(reviewed)
  expect(undone.cards).toEqual(library.cards)
  expect(undone.attempts).toEqual(next.attempts)
  expect(undone.practices[0]!.ratingUndoneAt).toBeDefined()
  expect(undone.practices[0]!.reviewId).toBeUndefined()
  expect(dailyUsage(undone, now).get('deck')!.new.size).toBe(0)
  expect(() => recordAttempt(reviewed, practice, completed)).toThrow()
  librarySchema.parse(undone)
})

it('practice-only completion preserves evidence and does not create a review', () => {
  const { library, practice, attempt } = example()
  const saved = recordAttempt(library, practice, attempt)
  const unknown = recordAttempt(saved, practice, { ...attempt, status: 'unknown' })
  const finished = finishPractice(unknown, practice.id, practice.cardId, undefined)
  expect(finished.practices[0]!.completion).toBe('practice')
  expect(finished.cards).toEqual(library.cards)
  expect(finished.reviews).toHaveLength(0)
  expect(() => finishPractice(finished, practice.id, practice.cardId, undefined)).toThrow()
  expect(removeNotes(finished, new Set([library.notes[0]!.id])).attempts).toEqual([])
  expect(() => librarySchema.parse({ ...finished, practices: [] })).toThrow()
})

it('stores and restores code and judge evidence through snapshots, archives and JSON', async () => {
  const { library, practice, attempt, pending, completed } = example()
  const repo = createRepository(crypto.randomUUID())
  await repo.save(library, 0)
  const saved = recordAttempt(
    recordAttempt(recordAttempt(library, practice, attempt), practice, pending),
    practice,
    completed,
  )
  await repo.save(saved, 1)
  expect((await repo.load()).library).toEqual(saved)
  await repo.backupNow(true)
  const checkpoint = (await repo.listBackups())[0]!
  expect(await repo.getBackup(checkpoint.id)).toEqual(saved)
  const archive = (await exportArchive(saved, async () => undefined))!
  expect((await parseArchive(archive)).library).toEqual(saved)
  expect(parseBackup(await exportBackup(saved, async () => undefined)).library).toEqual(saved)
  repo.close()
  const { practices: _practices, attempts: _attempts, ...old } = library
  expect(migrateLibrary({ ...old, version: 4 })).toEqual(library)
  expect(() => migrateLibrary({ ...old, version: 5 })).toThrow()
})
