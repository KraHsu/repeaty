import 'fake-indexeddb/auto'
import { openDB } from 'idb'
import { expect, it } from 'vitest'
import { readDraft, writeDraft, type Draft } from './drafts'
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
it('only migrates an unscoped legacy draft into the local library', async () => {
  const card = crypto.randomUUID()
  await writeDraft(card, draft)
  const db = await openDB('repeaty-leetcode-drafts', 1)
  await db.put('drafts', { ...draft, revision: 'old' }, card)
  await db.delete('drafts', JSON.stringify(['local:repeaty', card]))
  db.close()
  expect(await readDraft(card, 'new', 'https://first.example:alice', 'old')).toBeUndefined()
  expect(await readDraft(card, 'new', 'local:repeaty', 'old')).toEqual({
    ...draft,
    revision: 'new',
  })
  await writeDraft(card, undefined)
})
