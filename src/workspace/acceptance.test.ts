import { describe, expect, it } from 'vitest'
import {
  adaptCardDraft,
  mediaPath,
  prepareAcceptance,
  prepareDraftConfirmation,
  snapshotAsset,
} from './acceptance'
import { actualDraft, context, preparedAt, rawNote, workspaceId } from './test-fixtures'
import { createWorkspaceMarkdown, readWorkspaceMarkdown } from './markdown'
import { createSourceRevision, sha256 } from './source-revisions'

describe('Markdown acceptance plans', () => {
  it('keeps exact file bytes and stable new-card IDs on an identical retry', async () => {
    const raw = rawNote('reversed')
    const a = await prepareAcceptance(
      raw,
      'notes/question.md',
      'operation-1',
      context(),
      preparedAt,
    )
    const b = await prepareAcceptance(
      raw,
      'notes/question.md',
      'operation-1',
      context(),
      preparedAt,
    )
    expect(a.request).toEqual(b.request)
    expect(new TextDecoder().decode(a.bytes)).toBe(raw)
    expect(a.request.acceptance.variants).toEqual(['forward', 'reverse'])
    for (const card of a.request.new_cards) expect(JSON.parse(card.state_json).id).toBe(card.id)
  })
  it('only creates genuinely new variants and retains known retired mappings for restore', async () => {
    const before = {
      rawHash: 'a'.repeat(64),
      revision: 'b'.repeat(64),
      cards: [
        { cardId: 'old-1', variant: 'cloze:1', lifecycle: 'active' as const },
        { cardId: 'old-8', variant: 'cloze:8', lifecycle: 'retired' as const },
      ],
    }
    const original = structuredClone(before)
    const plan = await prepareAcceptance(
      rawNote('cloze', '{{c8::old}} {{c2::new}}', ''),
      'notes/q.md',
      'cloze-edit',
      { ...context(), before },
      preparedAt,
    )
    expect(plan.request.acceptance.expected_cards).toEqual([
      { id: 'old-1', variant: 'cloze:1', lifecycle: 'active' },
      { id: 'old-8', variant: 'cloze:8', lifecycle: 'retired' },
    ])
    expect(plan.request.new_cards.map((card) => card.variant)).toEqual(['cloze:2'])
    expect(before).toEqual(original)
  })
  it.each([
    ['---\nrepeaty: partial', 'invalid-note-document'],
    ['ordinary Markdown', 'invalid-note-document'],
    [rawNote('basic', 'Q', 'A', { deckId: 'missing' }), 'unknown-deck'],
  ])('does not produce a save for incomplete or unresolved input', async (raw, error) => {
    await expect(
      prepareAcceptance(raw, 'notes/q.md', 'edit', context(), preparedAt),
    ).rejects.toThrow(error)
  })
  it.each([
    '../../outside.png',
    '/outside.png',
    'file:///etc/passwd',
    '..\\assets\\x.png',
    '..%2f..%2foutside.png',
  ])('refuses unsafe local media URLs: %s', (url) => {
    expect(() => mediaPath(url, 'notes/q.md')).toThrow()
  })
  it('tracks explicit and inline HTML / Markdown media once and ignores fenced examples', async () => {
    const { draft } = await actualDraft()
    const asset = await snapshotAsset(draft.uploads[0]!.meta, draft.uploads[0]!.blob, true)
    const file = asset.snapshot.path.split('/')[1]!
    const front = `![图](../assets/${file})\n<audio src="../assets/${file}"></audio>\n\n\`\`\`md\n![示例](../../outside.png)\n\`\`\``
    const raw = rawNote('basic', front, 'A', {
      frontMedia: [{ id: asset.snapshot.id, path: asset.snapshot.path }],
    })
    const plan = await prepareAcceptance(
      raw,
      'notes/q.md',
      'media',
      { ...context(), assets: [asset] },
      preparedAt,
    )
    expect(plan.request.acceptance.assets).toEqual([asset.snapshot])
    expect(plan.objects.size).toBe(1)
    expect(await plan.objects.get(asset.snapshot.hash)!.text()).toBe('original image bytes')
  })
  it('parses media on each face independently when the other face has an unclosed fence', async () => {
    await expect(
      prepareAcceptance(
        rawNote('basic', '```text\nunclosed', '![图](../assets/missing.png)'),
        'notes/q.md',
        'media',
        context(),
        preparedAt,
      ),
    ).rejects.toThrow('missing-inline-media')
  })
  it('detects a mismatched attachment and ignores Markdown syntax in plain notes', async () => {
    await expect(
      prepareAcceptance(
        rawNote('basic', 'Q', 'A', { frontMedia: [{ id: 'absent', path: 'assets/absent.png' }] }),
        'notes/q.md',
        'edit',
        context(),
        preparedAt,
      ),
    ).rejects.toThrow('missing-or-mismatched-media')
    const raw = rawNote('basic', '![literal](../../outside.png)', 'A', { format: 'plain' })
    expect(
      (await prepareAcceptance(raw, 'notes/q.md', 'plain', context(), preparedAt)).request
        .acceptance.assets,
    ).toEqual([])
  })
  it('includes attachment bytes in the accepted version even when Markdown bytes are unchanged', async () => {
    const { draft } = await actualDraft()
    const first = await snapshotAsset(draft.uploads[0]!.meta, draft.uploads[0]!.blob)
    const changedBlob = new Blob(['changed image bytes'], { type: 'image/png' })
    const second = await snapshotAsset(
      { ...draft.uploads[0]!.meta, size: changedBlob.size },
      changedBlob,
    )
    const raw = rawNote('basic', 'Q', 'A', {
      frontMedia: [{ id: first.snapshot.id, path: first.snapshot.path }],
    })
    const a = await prepareAcceptance(
      raw,
      'notes/q.md',
      'a',
      { ...context(), assets: [first] },
      preparedAt,
    )
    const b = await prepareAcceptance(
      raw,
      'notes/q.md',
      'b',
      { ...context(), assets: [second] },
      preparedAt,
    )
    expect(a.request.acceptance.raw_hash).toBe(b.request.acceptance.raw_hash)
    expect(a.request.acceptance.revision).not.toBe(b.request.acceptance.revision)
  })
  it('retains unavailable plugin data without executing a plugin or restoring permissions', async () => {
    const raw = rawNote('plugin', 'Plugin question', '', {
      plugin: { id: 'unknown-plugin', version: 2, data: { question: '保留' } },
    })
    const plan = await prepareAcceptance(raw, 'notes/q.md', 'plugin', context(), preparedAt)
    expect(plan.warnings).toContain('plugin-unavailable')
    expect(new TextDecoder().decode(plan.bytes)).toBe(raw)
  })

  it('reports external media as a URL reference without fetching or claiming an offline snapshot', async () => {
    const plan = await prepareAcceptance(
      rawNote('basic', '![remote](https://example.com/image.png)', 'A'),
      'notes/q.md',
      'remote',
      context(),
      preparedAt,
    )
    expect(plan.objects.size).toBe(0)
    expect(plan.request.acceptance.assets).toEqual([])
    expect(plan.warnings).toContain('external-media-not-snapshotted')
  })
})

describe('actual persistent CardDraft adaptation', () => {
  it('preserves original draft IDs, ordering, raw input, attachments and immutable origin', async () => {
    const { draft, revision, origin } = await actualDraft()
    const adapted = await adaptCardDraft(draft, workspaceId, revision)
    expect(adapted.value).toMatchObject({
      id: draft.id,
      position: draft.position,
      title: draft.title,
      source_media_id: draft.mediaId,
      workspace_id: workspaceId,
    })
    expect(adapted.value).not.toHaveProperty('scope')
    expect(adapted.value).not.toHaveProperty('selectionId')
    const parsed = readWorkspaceMarkdown(adapted.value.raw)
    if (parsed.status !== 'managed') throw Error('invalid fixture')
    expect(parsed.document.content).toEqual({
      kind: 'draft',
      front: draft.input.front,
      back: draft.input.back,
    })
    expect(parsed.document.header.origin).toEqual(origin)
    const plan = await prepareDraftConfirmation(
      adapted.value,
      'confirm',
      { ...context(), assets: adapted.assets, sources: [revision] },
      preparedAt,
    )
    const retry = await prepareDraftConfirmation(
      adapted.value,
      'confirm',
      { ...context(), assets: adapted.assets, sources: [revision] },
      preparedAt,
    )
    expect(plan.request).toEqual(retry.request)
    expect(plan.request.draft_id).toBe(draft.id)
    expect(plan.request.acceptance.draft_hash).toBe(
      await sha256(new TextEncoder().encode(adapted.payload)),
    )
    expect(plan.request.acceptance.source).toMatchObject({
      source_id: revision.sourceId,
      revision_id: revision.id,
      start: origin.start,
      end: origin.end,
      quote: origin.quote,
    })
  })
  it('does not turn incomplete draft content into a formal note', async () => {
    const { draft, revision } = await actualDraft()
    draft.input.front = ''
    const adapted = await adaptCardDraft(draft, workspaceId, revision)
    await expect(
      prepareDraftConfirmation(
        adapted.value,
        'confirm',
        { ...context(), assets: adapted.assets, sources: [revision] },
        preparedAt,
      ),
    ).rejects.toThrow('empty-question')
  })
  it('does not apply the old quotation to a new source revision or another workspace', async () => {
    const { draft, revision } = await actualDraft()
    const adapted = await adaptCardDraft(draft, workspaceId, revision)
    const changed = await createSourceRevision(
      revision.sourceId,
      revision.format,
      'new source body',
    )
    await expect(
      prepareDraftConfirmation(
        adapted.value,
        'confirm',
        { ...context(), assets: adapted.assets, sources: [changed] },
        preparedAt,
      ),
    ).rejects.toThrow('missing-source-revision')
    await expect(
      prepareDraftConfirmation(
        adapted.value,
        'confirm',
        context('6e28e5b2-30f9-4393-9d9a-ecfdfb726078'),
        preparedAt,
      ),
    ).rejects.toThrow('draft-workspace-mismatch')
  })

  it('checks the immutable source body hash as well as its revision ID', async () => {
    const { draft, revision } = await actualDraft()
    const adapted = await adaptCardDraft(draft, workspaceId, revision)
    await expect(
      prepareDraftConfirmation(
        adapted.value,
        'confirm',
        {
          ...context(),
          assets: adapted.assets,
          sources: [{ ...revision, bodySha256: '0'.repeat(64) }],
        },
        preparedAt,
      ),
    ).rejects.toThrow('missing-source-revision')
  })
  it('retains an unknown editor property when confirming the draft', async () => {
    const { draft, revision } = await actualDraft()
    const adapted = await adaptCardDraft(draft, workspaceId, revision)
    const parsed = readWorkspaceMarkdown(adapted.value.raw)
    if (parsed.status !== 'managed' || parsed.document.content.kind !== 'draft')
      throw Error('invalid fixture')
    parsed.document.properties.editor = { unknown: 'keep' }
    adapted.value.raw = createWorkspaceMarkdown(parsed.document.properties, parsed.document.content)
    const plan = await prepareDraftConfirmation(
      adapted.value,
      'confirm',
      { ...context(), assets: adapted.assets, sources: [revision] },
      preparedAt,
    )
    expect(new TextDecoder().decode(plan.bytes)).toContain('unknown: keep')
  })
})
