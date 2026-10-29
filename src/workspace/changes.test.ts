import { describe, expect, it } from 'vitest'
import { createWorkspaceMarkdown, readWorkspaceMarkdown, type JsonObject } from './markdown'
import {
  classifyWorkspaceChanges,
  planVariants,
  workspacePathKey,
  type AcceptedFile,
} from './changes'

function raw(id = 'old-note', type = 'basic', front = 'Q', back = 'A') {
  return createWorkspaceMarkdown(
    { repeaty: { version: 1, kind: 'note', id, type, format: 'markdown', deckId: 'old-deck' } },
    { kind: 'note', front, back },
  )
}
function accepted(text = raw(), path = 'notes/original.md'): AcceptedFile {
  const result = readWorkspaceMarkdown(text)
  if (result.status !== 'managed') throw new Error('invalid-fixture')
  return {
    path,
    document: result.document,
    cards: result.document.variants.map((variant) => ({
      variant,
      cardId: `original-${variant}`,
      lifecycle: 'active',
      schedule: { due: '2026-11-12T10:00:00.000Z', stability: 8.174431 },
      reviews: ['old-review'],
    })),
  }
}
const scan = (
  before: AcceptedFile[],
  files: { path: string; raw?: string; error?: string; symbolicLink?: boolean }[],
  completeScan = true,
) => classifyWorkspaceChanges(before, files, { completeScan })

describe('stable file snapshots', () => {
  it('retains exact card records and IDs after a body/tag/deck edit', () => {
    const file = accepted()
    const before = structuredClone(file)
    const changedProperties = structuredClone(file.document.properties)
    ;(changedProperties.repeaty as JsonObject).deckId = 'another-known-deck'
    changedProperties.tags = ['edited']
    const edited = createWorkspaceMarkdown(changedProperties, {
      kind: 'note',
      front: '新的问题',
      back: '新的答案',
    })
    const decision = scan([file], [{ path: file.path, raw: edited }])[0]!
    expect(decision.status).toBe('modified')
    expect(decision.variants?.keep[0]).toBe(file.cards[0])
    expect(decision.variants?.create).toEqual([])
    expect(file).toEqual(before)
    expect(scan([file], [{ path: file.path, raw: edited }])).toEqual([decision])
  })
  it.each([
    ['notes/original.md', raw(), 'unchanged'],
    ['notes/子目录/新名字.md', raw(), 'renamed'],
    ['notes/moved.md', raw('old-note', 'basic', 'edited'), 'renamed-modified'],
  ])('recognizes %s without new card identities', (path, text, status) => {
    const file = accepted()
    const result = scan([file], [{ path, raw: text }])
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      status,
      previousPath: file.path,
      identity: file.document.identity,
    })
    expect(result[0]!.variants!.keep[0]).toBe(file.cards[0])
  })
  it('does not choose a winner when an ID is copied, including a broken copy', () => {
    const file = accepted()
    const invalidCopy = raw().replace('\n<!-- repeaty:answer -->\nA', '')
    for (const copy of [raw(), invalidCopy]) {
      expect(
        scan(
          [file],
          [
            { path: file.path, raw: raw() },
            { path: 'notes/copy.md', raw: copy },
          ],
        ).map(({ status, reason }) => ({ status, reason })),
      ).toEqual(Array(2).fill({ status: 'conflict', reason: 'duplicate-id' }))
    }
  })
  it('reports identity edits and removed identity as conflicts', () => {
    for (const text of [
      raw('changed-id'),
      'Q with no metadata',
      raw().replace('  id: old-note\n', ''),
    ]) {
      expect(scan([accepted()], [{ path: 'notes/original.md', raw: text }])[0]!.status).toBe(
        'conflict',
      )
    }
  })
  it('allows two files to swap paths and a new file at a vacated path', () => {
    const a = accepted(raw('a'), 'notes/a.md'),
      b = accepted(raw('b'), 'notes/b.md')
    expect(
      scan(
        [a, b],
        [
          { path: b.path, raw: a.document.raw },
          { path: a.path, raw: b.document.raw },
        ],
      ).map((item) => item.status),
    ).toEqual(['renamed', 'renamed'])
    expect(
      scan(
        [a],
        [
          { path: 'notes/moved.md', raw: a.document.raw },
          { path: a.path, raw: raw('new') },
        ],
      ).map((item) => item.status),
    ).toEqual(['renamed', 'new'])
  })

  it('does not accept an identity change based on an invalid moved copy', () => {
    const file = accepted()
    const result = scan(
      [file],
      [
        { path: 'elsewhere/copy.md', raw: file.document.raw },
        { path: file.path, raw: raw('changed-id') },
      ],
    )
    expect(result.map((item) => item.status)).toEqual(['pending', 'conflict'])
  })
  it('requires a complete scan before proposing stable deletion and never retires on an event alone', () => {
    const file = accepted()
    expect(scan([file], [], false)).toEqual([])
    const result = scan([file], [])
    expect(result).toEqual([
      {
        path: file.path,
        identity: file.document.identity,
        status: 'missing',
        reason: 'confirm-stable-deletion',
      },
    ])
    expect(result[0]).not.toHaveProperty('variants')
    expect(scan([file], [{ path: file.path, raw: file.document.raw }])[0]!.status).toBe('unchanged')
  })
  it.each([
    [{ raw: '---\nrepeaty: half-write' }, 'unclosed-frontmatter'],
    [{ error: 'temporary-access-denied' }, 'unreadable-file'],
    [{ raw: raw(), symbolicLink: true }, 'symbolic-link'],
  ])(
    'keeps the last accepted version on partial writes or failed reads (%j)',
    (observation, reason) => {
      const file = accepted()
      expect(scan([file], [{ path: file.path, ...observation }])).toMatchObject([
        { status: 'pending', reason },
      ])
      expect(file.document.raw).toBe(raw())
    },
  )
  it('does not register ordinary files or repeatedly invent IDs for missing metadata', () => {
    const files = [
      { path: 'notes/plain.md', raw: 'ordinary' },
      { path: 'notes/unregistered.md', raw: raw().replace('  id: old-note\n', '') },
    ]
    const results = scan([], files)
    expect(results.map((file) => file.status)).toEqual(['unmanaged', 'unregistered'])
    expect(scan([], files)).toEqual(results)
    expect(JSON.stringify(results)).not.toContain('cardId')
  })
  it('keeps unresolved references pending rather than accepting a syntactically valid file', () => {
    const file = accepted()
    const result = classifyWorkspaceChanges([file], [{ path: file.path, raw: raw() }], {
      completeScan: true,
      acceptanceIssues: () => ['unknown-deck', 'missing-asset', 'plugin-unavailable'],
    })
    expect(result).toMatchObject([
      { status: 'pending', reason: 'unknown-deck, missing-asset, plugin-unavailable' },
    ])
    expect(result[0]).not.toHaveProperty('variants')
  })
  it('detects case and Unicode-normalized path collisions without merging identities', () => {
    const result = classifyWorkspaceChanges(
      [],
      [
        { path: 'notes/é.md', raw: raw('a') },
        { path: 'NOTES/e\u0301.MD', raw: raw('b') },
      ],
      { completeScan: true, caseSensitive: false },
    )
    expect(result.map((item) => item.reason)).toEqual(['duplicate-path', 'duplicate-path'])
  })
  it.each([
    '/notes/a.md',
    'notes/../outside.md',
    '../a.md',
    'C:/a.md',
    'notes\\a.md',
    'notes//a.md',
    'notes/./a.md',
    'notes/\u0000a.md',
  ])('rejects unsafe logical paths (%j)', (path) => {
    expect(workspacePathKey(path)).toBeUndefined()
    expect(scan([], [{ path, raw: raw() }])).toMatchObject([
      { status: 'pending', reason: 'invalid-workspace-path' },
    ])
  })
})

describe('variant lifecycle proposals', () => {
  it('only adds the reverse card when switching basic to reversed', () => {
    const file = accepted()
    const plan = scan([file], [{ path: file.path, raw: raw('old-note', 'reversed') }])[0]!.variants!
    expect(plan.keep).toEqual(file.cards)
    expect(plan.create).toEqual(['reverse'])
    expect(plan.retire).toEqual([])
  })
  it('retires a removed cloze number and restores its original mapping later', () => {
    const file = accepted(raw('old-note', 'cloze', '{{c1::A}} {{c8::B}}', ''))
    const removed = scan(
      [file],
      [{ path: file.path, raw: raw('old-note', 'cloze', '{{c1::A}}', '') }],
    )[0]!
    expect(removed.variants!.keep[0]).toBe(file.cards[0])
    expect(removed.variants!.retire[0]).toBe(file.cards[1])
    const after: AcceptedFile = {
      path: file.path,
      document: removed.document!,
      cards: [file.cards[0]!, { ...file.cards[1]!, lifecycle: 'retired' }],
    }
    const restored = scan([after], [{ path: file.path, raw: file.document.raw }])[0]!.variants!
    expect(restored.create).toEqual([])
    expect(restored.restore[0]).toBe(after.cards[1])
    expect(restored.restore[0]!.cardId).toBe('original-cloze:8')
  })
  it('never transfers progress based on similar cloze answers', () => {
    const file = accepted(raw('old-note', 'cloze', '{{c1::same answer}}', ''))
    const plan = scan(
      [file],
      [{ path: file.path, raw: raw('old-note', 'cloze', '{{c2::same answer}}', '') }],
    )[0]!.variants!
    expect(plan.keep).toEqual([])
    expect(plan.retire).toEqual(file.cards)
    expect(plan.create).toEqual(['cloze:2'])
  })
  it('rejects corrupt mapping instead of silently picking a card', () => {
    const card = accepted().cards[0]!
    expect(() => planVariants([card, card], ['forward'])).toThrow('duplicate-variant-mapping')
  })
})
