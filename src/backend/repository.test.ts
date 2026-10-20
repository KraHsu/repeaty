import { afterEach, expect, it } from 'vitest'
import { createServerRepository } from './repository'
import { setApiTransport } from './client'
import { summarizeAttempt } from '../core/practice-data'
import { reviewCard } from '../core/scheduler'
import { practiceHistoryFixture } from '../../tests/fixtures/practice-history'

afterEach(() => setApiTransport(() => Promise.reject(new Error('No test transport'))))

it('uses summaries on a capable service, reads complete bodies separately and sends only changed records', async () => {
  const library = practiceHistoryFixture(3)
  const calls: { path: string; body: unknown }[] = []
  let patches: { store: string; value?: unknown }[] = []
  setApiTransport(async (path, init) => {
    const input = init.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ path, body: input })
    if (path === '/status') return Response.json({ apiVersion: 10, historyVersion: 1 })
    if (path === '/auth/session') return Response.json({ user: { id: 'alice' } })
    expect(new Headers(init.headers).get('X-Repeaty-User')).toBe('alice')
    if (path === '/library/summary')
      return Response.json({
        revision: 1,
        library: { ...library, attempts: library.attempts.map(summarizeAttempt) },
      })
    if (path === '/library/attempts')
      return Response.json({
        revision: input.revision,
        attempts:
          input.mode === 'one'
            ? library.attempts.filter((entry) => entry.id === input.id)
            : library.attempts.slice(input.offset, input.offset + 128),
      })
    if (path === '/library/commit') {
      patches = input.patches
      return Response.json({ revision: input.expectedRevision + 1 })
    }
    throw new Error(`Unexpected path: ${path}`)
  })
  const repo = createServerRepository('https://example.test')
  const saved = await repo.load()
  expect(saved.library.attempts.every((entry) => entry.code === undefined)).toBe(true)
  expect(await repo.getAttempt(library.attempts[0]!.id, 1)).toEqual(library.attempts[0])
  expect(await repo.completeLibrary()).toEqual(library)
  expect(calls.some((call) => call.path === '/library')).toBe(false)
  const graded = reviewCard(saved.library, library.cards[0]!.id, 3, new Date(), 'filtered')
  await repo.save(graded, 1)
  expect(patches.map((patch) => patch.store).sort()).toEqual(['cards', 'reviews'])
  await expect(repo.getAttempt(library.attempts[0]!.id, 1)).rejects.toThrow('另一个页面')
})

it('reads an API v9 service without the optional summary endpoints', async () => {
  const library = practiceHistoryFixture(3)
  const calls: string[] = []
  setApiTransport(async (path) => {
    calls.push(path)
    if (path === '/status') return Response.json({ apiVersion: 10 })
    if (path === '/auth/session') return Response.json({ user: { id: 'alice' } })
    if (path === '/library') return Response.json({ revision: 1, library })
    throw new Error(`Unexpected path: ${path}`)
  })
  const repo = createServerRepository('https://legacy.example.test')
  expect((await repo.load()).library).toEqual(library)
  expect(await repo.getAttempt(library.attempts[0]!.id, 1)).toEqual(library.attempts[0])
  expect(await repo.completeLibrary()).toEqual(library)
  expect(calls).toEqual(['/status', '/auth/session', '/library'])
})

it('rejects an API v8 service before reading or writing a library with reading intervals', async () => {
  const calls: string[] = []
  setApiTransport(async (path) => {
    calls.push(path)
    return Response.json({ apiVersion: 9 })
  })
  await expect(createServerRepository('https://old.example.test').load()).rejects.toThrow()
  expect(calls).toEqual(['/status'])
})

it('rejects a mismatched body response instead of displaying another submission', async () => {
  const library = practiceHistoryFixture(3)
  setApiTransport(async (path) => {
    if (path === '/status') return Response.json({ apiVersion: 10, historyVersion: 1 })
    if (path === '/auth/session') return Response.json({ user: { id: 'alice' } })
    if (path === '/library/summary')
      return Response.json({
        revision: 1,
        library: { ...library, attempts: library.attempts.map(summarizeAttempt) },
      })
    return Response.json({ revision: 1, attempts: [library.attempts[1]] })
  })
  const repo = createServerRepository('https://example.test')
  await repo.load()
  await expect(repo.getAttempt(library.attempts[0]!.id, 1)).rejects.toThrow('另一个页面')
  await expect(repo.readAttemptBatch(0, 1)).rejects.toThrow('另一个页面')
})
