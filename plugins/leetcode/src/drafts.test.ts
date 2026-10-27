import { expect, it, vi, beforeEach } from 'vitest'
import { readDraft, writeDraft, type Draft } from './drafts'
const values = vi.hoisted(() => new Map<string, unknown>())
vi.mock('@repeaty/plugin-api', () => ({
  pluginData: {
    async get(id: string, scope: string) {
      return values.get(JSON.stringify([scope, id]))
    },
    async set(id: string, value: unknown, scope: string) {
      const key = JSON.stringify([scope, id])
      if (value === undefined) values.delete(key)
      else values.set(key, structuredClone(value))
    },
  },
}))
beforeEach(() => values.clear())
const draft: Draft = {
  revision: 'content',
  lang: 'python3',
  code: { python3: 'return value' },
  attempts: 0,
  elapsedMs: 1000,
  answerSeen: false,
  awaitingSubmit: false,
  uncertain: false,
  mode: 'manual',
}
it('isolates drafts for the same card across local, account and upstream scopes', async () => {
  const card = crypto.randomUUID()
  await writeDraft(card, draft, 'local:repeaty')
  expect(await readDraft(card, 'content', 'https://first.example:alice')).toBeUndefined()
  await writeDraft(
    card,
    { ...draft, code: { python3: 'account code' } },
    'https://first.example:alice',
  )
  expect(await readDraft(card, 'content', 'https://second.example:alice')).toBeUndefined()
  expect(await readDraft(card, 'content', 'https://first.example:bob')).toBeUndefined()
  expect((await readDraft(card, 'content', 'local:repeaty'))!.code.python3).toBe('return value')
  await writeDraft(card, undefined, 'https://first.example:alice')
  expect(await readDraft(card, 'content', 'https://first.example:alice')).toBeUndefined()
  expect(await readDraft(card, 'changed', 'local:repeaty')).toBeUndefined()
})
it('rejects stale or malformed saved drafts without changing their stored bodies', async () => {
  const card = crypto.randomUUID()
  await writeDraft(card, draft)
  const key = JSON.stringify(['local:repeaty', card])
  expect(await readDraft(card, 'new')).toBeUndefined()
  expect(values.get(key)).toEqual(draft)
  const malformed = { ...draft, code: { python3: 'x'.repeat(50_001) } }
  values.set(key, malformed)
  expect(await readDraft(card, 'content')).toBeUndefined()
  expect(values.get(key)).toBe(malformed)
  await expect(writeDraft(card, malformed)).rejects.toThrow()
  expect(values.get(key)).toBe(malformed)
  await writeDraft(card, undefined)
  expect(values.has(key)).toBe(false)
})
