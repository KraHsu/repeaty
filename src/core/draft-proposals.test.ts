import { expect, it } from 'vitest'
import { fixture } from './test-fixtures'
import { addSource, prepareSource, sourceExcerpt, replaceSourceContent } from './sources'
import { DraftSession, MAX_DRAFTS, MAX_PROPOSALS } from './draft-proposals'

function example() {
  const text = 'private prefix\n选中的摘录🙂\nprivate suffix'
  const { source, asset } = prepareSource({
    title: 'Saved source',
    url: 'https://private.example/path?token=private-link',
    format: 'markdown',
    content: text,
  })
  const library = addSource(fixture(), source, asset)
  const context = { library, revision: 7, scope: 'local:repeaty' }
  const excerpt = sourceExcerpt(
    source,
    text,
    text.indexOf('选中'),
    text.indexOf('\nprivate suffix'),
  )
  const session = new DraftSession()
  session.bindScope(context.scope)
  const share = () => session.share(context, excerpt, 'deck', source.mediaId, text)
  const args = (requestId = 'request-1') => ({
    selectionId: session.selection!.selectionId,
    requestId,
    cards: [{ type: 'basic', front: 'Question', back: 'Answer', tags: ['example'] }],
  })
  return { session, context, excerpt, source, text, share, args }
}

it('shares only the explicitly selected excerpt and never the rest of its snapshot', () => {
  const { session, context, share, excerpt } = example()
  expect(() => session.readSelection(context, {})).toThrow('selection-unavailable')
  share()
  const data = session.readSelection(context, {})
  expect(data).toMatchObject({ text: excerpt.quote, title: 'Saved source', deck: { id: 'deck' } })
  expect(JSON.stringify(data)).not.toMatch(
    /private prefix|private suffix|private-link|private.example|mediaId|sourceId|start|end/,
  )
  expect(() => session.readSelection(context, { sourceId: 'anything' })).toThrow(
    'invalid-arguments',
  )
  expect(() => session.readSelection({ ...context, scope: 'server:user' }, {})).toThrow(
    'library-unavailable',
  )
})
it('keeps received drafts and explicit shares bound to the original source version after an edit', () => {
  const { session, context, share, source, args, excerpt } = example()
  share()
  const proposal = session.prepare(context, args())
  proposal.finish(true)
  const changed = replaceSourceContent(context.library, source.id, {
    title: 'New',
    url: '',
    format: 'markdown',
    content: 'A shorter replacement',
  })
  const updated = { ...context, library: changed.library, revision: 8 }
  expect(session.readSelection(updated, {}).text).toBe(excerpt.quote)
  expect(session.getDraft(updated, session.drafts[0]!.id).excerpt.mediaId).toBe(source.mediaId)
})

it('accepts all three note types as drafts only after acknowledgement, without changing study records', () => {
  const { session, context, share, args } = example()
  share()
  const before = JSON.stringify(context.library)
  const input = args()
  input.cards.push(
    { type: 'reversed', front: 'Forward', back: 'Reverse', tags: [] },
    { type: 'cloze', front: 'A {{c1::gap}}', back: '', tags: [] },
  )
  const proposal = session.prepare(context, input)
  expect(session.drafts).toHaveLength(0)
  proposal.finish(true)
  proposal.finish(true)
  expect(session.drafts.map((entry) => entry.input.type)).toEqual(['basic', 'reversed', 'cloze'])
  expect(
    session.drafts.every((entry) => entry.excerpt.quote === session.selection!.excerpt.quote),
  ).toBe(true)
  expect(JSON.stringify(context.library)).toBe(before)
  const draft = session.getDraft(context, session.drafts[0]!.id)
  draft.input.tags.push('changed')
  expect(session.drafts[0]!.input.tags).toEqual(['example'])
})

it('rejects malformed batches atomically, including plugins, media, missing answers and invalid clozes', () => {
  const { session, context, share, args } = example()
  share()
  for (const cards of [
    [{ type: 'basic', front: 'Q', back: '' }],
    [{ type: 'cloze', front: 'No cloze', back: '' }],
    [{ type: 'plugin', front: 'Q', back: 'A' }],
    [{ type: 'basic', front: 'Q', back: 'A', frontMedia: ['file'] }],
    [{ type: 'basic', front: 'Q', back: 'A', deckId: 'other' }],
    Array.from({ length: 11 }, () => ({ type: 'basic', front: 'Q', back: 'A' })),
    Array.from({ length: 6 }, () => ({ type: 'basic', front: 'Q'.repeat(10_000), back: 'A' })),
  ]) {
    expect(() => session.prepare(context, { ...args(), cards })).toThrow('invalid-arguments')
    expect(session.drafts).toHaveLength(0)
  }
  expect(() => session.prepare(context, { ...args(), selectionId: crypto.randomUUID() })).toThrow(
    'selection-unavailable',
  )
})

it('retries one request without duplicating drafts, including after review, discard and lost acknowledgements', () => {
  const { session, context, share, args } = example()
  share()
  const lost = session.prepare(context, args())
  lost.finish(false)
  expect(session.drafts).toHaveLength(0)
  const first = session.prepare(context, args())
  const concurrent = session.prepare(context, args())
  expect(concurrent.receipt).toEqual(first.receipt)
  concurrent.finish(false)
  first.finish(true)
  expect(session.drafts).toHaveLength(1)
  const retry = session.prepare(context, args())
  retry.finish(true)
  expect(retry.receipt).toEqual(first.receipt)
  session.discard(first.receipt.draftIds[0]!)
  session.prepare(context, args()).finish(true)
  expect(session.drafts).toHaveLength(0)
  expect(() =>
    session.prepare(context, {
      ...args(),
      cards: [{ type: 'basic', front: 'Different', back: 'A' }],
    }),
  ).toThrow('request-conflict')
})

it('revoking or replacing a selection cancels staged proposals and retains already received drafts', () => {
  const { session, context, share, args } = example()
  share()
  session.prepare(context, args('received')).finish(true)
  const old = args('staged')
  const proposal = session.prepare(context, old)
  session.revoke()
  proposal.finish(true)
  expect(session.drafts).toHaveLength(1)
  expect(session.getDraft(context, session.drafts[0]!.id)).toBeDefined()
  share()
  expect(() => session.prepare(context, old)).toThrow('selection-unavailable')
  const another = session.prepare(context, args())
  session.bindScope('')
  session.bindScope(context.scope)
  another.finish(true)
  expect(session.drafts).toHaveLength(0)
  expect(session.selection).toBeUndefined()
})

it('rejects changed or deleted sources and decks before reading, proposing or reviewing a draft', () => {
  const { session, context, share, args, source } = example()
  share()
  session.prepare(context, args()).finish(true)
  const changed = {
    ...context,
    library: { ...context.library, sources: [{ ...source, mediaId: 'changed' }] },
  }
  expect(() => session.readSelection(changed, {})).toThrow('selection-unavailable')
  expect(() => session.prepare(changed, args())).toThrow('selection-unavailable')
  expect(() => session.getDraft(changed, session.drafts[0]!.id)).toThrow('selection-unavailable')
  expect(() =>
    session.prepare({ ...context, library: { ...context.library, decks: [] } }, args()),
  ).toThrow('selection-unavailable')
})

it('bounds received drafts and reserved batches as well as retry memory', () => {
  const { session, context, share, args } = example()
  share()
  const pending = Array.from({ length: MAX_DRAFTS / 10 }, (_, index) =>
    session.prepare(context, {
      ...args(String(index)),
      cards: Array.from({ length: 10 }, () => args().cards[0]),
    }),
  )
  expect(() => session.prepare(context, args('full'))).toThrow('draft-limit')
  pending[0]!.finish(false)
  session.prepare(context, args('freed')).finish(true)
  pending.slice(1).forEach((entry) => entry.finish(true))
  expect(session.drafts).toHaveLength(41)
  share()
  for (let index = 0; index < MAX_PROPOSALS; index++) {
    const proposal = session.prepare(context, args(String(index)))
    proposal.finish(true)
    session.discard(proposal.receipt.draftIds[0]!)
  }
  expect(() => session.prepare(context, args('too-many'))).toThrow('draft-limit')
})
