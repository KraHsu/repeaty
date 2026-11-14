import { describe, expect, it } from 'vitest'
import {
  createSourceRevision,
  editSourceQuote,
  quoteSource,
  readSourceQuote,
} from './source-revisions'

describe('immutable source revision prototype', () => {
  it('keeps old excerpt/card/draft quotes on the old revision after an external edit', async () => {
    const original = await createSourceRevision(
      'source-old',
      'markdown',
      'prefix\r\n中文🙂 selected\r\nsuffix',
    )
    const quote = quoteSource(
      original,
      original.body.indexOf('中文'),
      original.body.indexOf('\r\nsuffix'),
    )
    const cardOrigin = quote,
      draftOrigin = quote
    const changed = await createSourceRevision(
      'source-old',
      'markdown',
      'A completely changed beginning\n中文🙂 selected\nnew end',
    )
    expect(changed.sourceId).toBe(original.sourceId)
    expect(changed.id).not.toBe(original.id)
    expect(quote.quote).toBe('中文🙂 selected')
    expect(readSourceQuote(original, cardOrigin)).toBe(quote.quote)
    expect(readSourceQuote(original, draftOrigin)).toBe(quote.quote)
    expect(() => readSourceQuote(changed, quote)).toThrow('source-revision-mismatch')
    expect(Object.isFrozen(original)).toBe(true)
  })
  it('preserves multi-level lineage and labels edited excerpts as derived', async () => {
    const parent = await createSourceRevision('parent', 'plain', 'abc 中文🙂 xyz')
    const parentRange = quoteSource(parent, 4, 8)
    const child = await createSourceRevision('excerpt', 'plain', parentRange.quote)
    const childRange = quoteSource(child, 0, 2)
    const edited = editSourceQuote(childRange, '自己的解释')
    expect(edited).toEqual({ kind: 'edited', body: '自己的解释', derivedFrom: childRange })
    expect(readSourceQuote(child, edited.derivedFrom)).toBe('中文')
    expect(readSourceQuote(parent, parentRange)).toBe('中文🙂')
    expect(edited).not.toHaveProperty('start')
  })
  it('is deterministic on retry and separates source identity/format/newlines', async () => {
    const first = await createSourceRevision('id', 'plain', 'a\r\nb')
    expect(await createSourceRevision('id', 'plain', 'a\r\nb')).toEqual(first)
    for (const [id, format, body] of [
      ['other', 'plain', 'a\r\nb'],
      ['id', 'markdown', 'a\r\nb'],
      ['id', 'plain', 'a\nb'],
    ] as const) {
      expect((await createSourceRevision(id, format, body)).id).not.toBe(first.id)
    }
  })
  it('rejects invalid ranges and forged quote text', async () => {
    const revision = await createSourceRevision('id', 'plain', 'abc🙂')
    for (const [start, end] of [
      [-1, 2],
      [0, 6],
      [2, 2],
      [0.5, 2],
      [0, Infinity],
      [3, 4],
      [4, 5],
    ]) {
      expect(() => quoteSource(revision, start!, end!)).toThrow('invalid-source-range')
    }
    expect(() =>
      readSourceQuote(revision, { ...quoteSource(revision, 0, 2), quote: 'xx' }),
    ).toThrow('source-quote-mismatch')
  })
})
