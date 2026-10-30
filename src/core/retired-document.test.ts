import { expect, it, vi } from 'vitest'
import { fixture } from './test-fixtures'
import { prepareRetiredDocument } from './retired-document'
import { createWorkspaceMarkdown, readWorkspaceMarkdown } from '../workspace/markdown'
import { sha256 } from '../workspace/source-revisions'

it('pairs newer note bodies, variants and attachments with their retired raw while retaining unrelated YAML', async () => {
  const note = fixture({
    type: 'plugin',
    plugin: { id: 'visual-occlusion', version: 1, variants: ['old'], data: {} },
  }).notes[0]!
  const raw = createWorkspaceMarkdown(
    {
      custom: { keep: 'user value' },
      repeaty: {
        version: 1,
        kind: 'note',
        id: note.id,
        type: note.type,
        format: note.format,
        deckId: note.deckId,
        plugin: note.plugin!,
        backMedia: [{ id: 'retained', path: 'assets/custom-existing.png' }],
      },
    },
    { kind: 'note', front: note.front, back: note.back },
  )
  const prior = {
    id: note.id,
    kind: 'note' as const,
    path: 'notes/custom.md',
    raw,
    hash: await sha256(new TextEncoder().encode(raw)),
  }
  const image = new Blob(['new image'], { type: 'image/png' }),
    getMedia = vi.fn(async () => image)
  const newer = {
    ...note,
    front: 'Changed question',
    tags: ['new'],
    backMedia: ['retained', 'new-image'],
    plugin: { ...note.plugin!, variants: ['new', 'remaining'] },
  }
  const next = await prepareRetiredDocument(newer, prior, getMedia)
  expect(next!.hash).toBe(await sha256(new TextEncoder().encode(next!.raw)))
  const parsed = readWorkspaceMarkdown(next!.raw)
  if (parsed.status !== 'managed') throw new Error('not managed')
  expect(parsed.document.content).toEqual({ kind: 'note', front: newer.front, back: newer.back })
  expect(parsed.document.header.plugin!.variants).toEqual(['new', 'remaining'])
  expect(parsed.document.header.backMedia![0]!.path).toBe('assets/custom-existing.png')
  expect(parsed.document.header.backMedia![1]!.path).toBe(
    `assets/${await sha256(new Uint8Array(await image.arrayBuffer()))}.png`,
  )
  expect(parsed.document.properties.custom).toEqual({ keep: 'user value' })
  expect(getMedia).toHaveBeenCalledExactlyOnceWith('new-image')
  expect(next!.path).toBe(prior.path)
  expect(prior.raw).toBe(raw)
})

it('clears removed excerpt and inline media and removes plugin metadata when changing note type', async () => {
  const note = fixture({ type: 'basic' }).notes[0]!
  const raw = createWorkspaceMarkdown(
    {
      custom: { keep: true },
      repeaty: {
        version: 1,
        kind: 'note',
        id: note.id,
        type: 'plugin',
        format: note.format,
        deckId: note.deckId,
        plugin: { id: 'visual-occlusion', version: 1, variants: ['old'], data: {} },
        excerpt: { sourceId: 'removed-source', start: 0, end: 3, quote: 'old' },
        inlineMedia: [
          {
            mediaId: 'removed-media',
            url: './old.png',
            path: 'assets/old.png',
            hash: 'a'.repeat(64),
          },
        ],
      },
    },
    { kind: 'note', front: 'Old question', back: 'Old answer' },
  )
  const prior = {
    id: note.id,
    kind: 'note' as const,
    path: 'notes/custom.md',
    raw,
    hash: await sha256(new TextEncoder().encode(raw)),
  }
  const getMedia = vi.fn(async () => undefined)
  const next = await prepareRetiredDocument(note, prior, getMedia)
  const parsed = readWorkspaceMarkdown(next!.raw)
  if (parsed.status !== 'managed') throw new Error('not managed')
  expect(parsed.document.header.type).toBe('basic')
  expect(parsed.document.header.plugin).toBeUndefined()
  expect(parsed.document.header.excerpt).toBeNull()
  expect(parsed.document.header.inlineMedia).toEqual([])
  expect(parsed.document.content).toEqual({ kind: 'note', front: note.front, back: note.back })
  expect(parsed.document.properties.custom).toEqual({ keep: true })
  expect(next!.raw).not.toContain('removed-source')
  expect(next!.raw).not.toContain('removed-media')
  expect(next!.hash).toBe(await sha256(new TextEncoder().encode(next!.raw)))
  expect(getMedia).not.toHaveBeenCalled()
  expect(prior.raw).toBe(raw)
})
