import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import {
  adaptCardDraft,
  prepareAcceptance,
  prepareDraftConfirmation,
  snapshotAsset,
  type AcceptanceContext,
  type PreparedAcceptance,
} from '../../src/workspace/acceptance'
import { actualDraft, context, preparedAt, rawNote } from '../../src/workspace/test-fixtures'
import { sha256 } from '../../src/workspace/source-revisions'

const snapshotSchema = z.object({
  workspace_id: z.uuid(),
  raw_hash: z.string().nullable(),
  revision: z.string().nullable(),
  changes: z.number(),
  versions: z.number(),
  cards: z.array(
    z.object({
      id: z.string(),
      variant: z.string(),
      lifecycle: z.enum(['active', 'retired']),
      state_json: z.string(),
      last_revision: z.string().nullable(),
    }),
  ),
  drafts: z.array(
    z.object({ id: z.string(), payload: z.string(), consumed_by: z.string().nullable() }),
  ),
})
type Snapshot = z.infer<typeof snapshotSchema>
let binary: string
const temporary: string[] = []
beforeAll(() => {
  const manifest = 'crates/workspace-store/Cargo.toml'
  execFileSync(
    'cargo',
    ['build', '--locked', '--manifest-path', manifest, '--example', 'acceptance-fixture'],
    { stdio: 'pipe' },
  )
  const metadata = JSON.parse(
    execFileSync(
      'cargo',
      ['metadata', '--no-deps', '--format-version', '1', '--manifest-path', manifest],
      { encoding: 'utf8' },
    ),
  ) as { target_directory: string }
  binary = join(
    metadata.target_directory,
    'debug',
    'examples',
    `acceptance-fixture${process.platform === 'win32' ? '.exe' : ''}`,
  )
})
afterEach(async () => {
  for (const path of temporary.splice(0)) await rm(path, { recursive: true, force: true })
})

function rpc(command: Record<string, unknown>, expectedStatus = 0): unknown {
  const child = spawnSync(binary, [], {
    input: JSON.stringify(command),
    encoding: 'utf8',
    timeout: 30_000,
    maxBuffer: 4 * 1024 * 1024,
  })
  if (child.error) throw child.error
  if (child.status !== expectedStatus) throw Error(`Native exit ${child.status}: ${child.stderr}`)
  return expectedStatus ? undefined : JSON.parse(child.stdout)
}
async function fixture() {
  const parent = await mkdtemp(join(tmpdir(), 'repeaty-acceptance-'))
  temporary.push(parent)
  const root = join(parent, 'root'),
    incoming = join(parent, 'incoming')
  await mkdir(root)
  await mkdir(incoming)
  const identity = z.object({ workspace_id: z.uuid() }).parse(rpc({ action: 'create', root }))
  rpc({ action: 'seed_deck', root, id: 'deck' })
  const base = context(identity.workspace_id)
  const snapshot = (noteId: string) =>
    snapshotSchema.parse(rpc({ action: 'snapshot', root, note_id: noteId }))
  async function save(plan: PreparedAcceptance, exitAt?: string) {
    for (const [hash, blob] of plan.objects)
      await writeFile(join(incoming, hash), new Uint8Array(await blob.arrayBuffer()))
    return rpc(
      {
        action: 'save',
        root,
        request: plan.request,
        raw: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(plan.bytes),
        incoming,
        exit_at: exitAt ?? null,
      },
      exitAt ? 86 : 0,
    )
  }
  return { root, incoming, base, snapshot, save }
}
function withBefore(base: AcceptanceContext, snapshot: Snapshot): AcceptanceContext {
  if (!snapshot.raw_hash || !snapshot.revision) throw Error('missing accepted baseline')
  return {
    ...base,
    before: {
      rawHash: snapshot.raw_hash,
      revision: snapshot.revision,
      cards: snapshot.cards.map((card) => ({
        cardId: card.id,
        variant: card.variant,
        lifecycle: card.lifecycle,
      })),
    },
  }
}
function objectPath(root: string, hash: string) {
  return join(root, '.repeaty', 'objects', 'sha256', hash.slice(0, 2), hash)
}

describe('shared Markdown validator → native journal → actual SQLite', () => {
  it('retires and restores cloze identities with exact stored scheduling and old content', async () => {
    const f = await fixture()
    const raw = '\uFEFF' + rawNote('cloze', '{{c1::中文}} 与 {{c8::🙂}}', '')
    const first = await prepareAcceptance(raw, 'notes/cloze.md', 'create-cloze', f.base, preparedAt)
    // Synthetic already-learned state, as would be imported; content edits must never recompute it.
    for (const card of first.request.new_cards) {
      const state = JSON.parse(card.state_json) as Record<string, unknown>
      state.schedule = { due: '2027-04-23T12:34:56.000Z', stability: 8.12345678901234, reps: 7 }
      state.suspended = true
      card.state_json = JSON.stringify(state)
    }
    expect(await f.save(first)).toHaveProperty('Committed')
    const original = f.snapshot(first.request.note_id)
    const removed = await prepareAcceptance(
      rawNote('cloze', '{{c1::改写}}', ''),
      'notes/cloze.md',
      'retire-cloze',
      withBefore(f.base, original),
      preparedAt,
    )
    expect(await f.save(removed)).toHaveProperty('Committed')
    const retired = f.snapshot(first.request.note_id)
    expect(retired.cards.find((card) => card.variant === 'cloze:8')).toMatchObject({
      lifecycle: 'retired',
      last_revision: original.revision,
    })
    expect(retired.cards.map((card) => card.state_json)).toEqual(
      original.cards.map((card) => card.state_json),
    )
    const restored = await prepareAcceptance(
      raw,
      'notes/cloze.md',
      'restore-cloze',
      withBefore(f.base, retired),
      preparedAt,
    )
    expect(restored.request.new_cards).toEqual([])
    expect(await f.save(restored)).toHaveProperty('Committed')
    const after = f.snapshot(first.request.note_id)
    expect(after.cards.map(({ id, state_json }) => ({ id, state_json }))).toEqual(
      original.cards.map(({ id, state_json }) => ({ id, state_json })),
    )
    expect(after.cards.every((card) => card.lifecycle === 'active')).toBe(true)
    expect(after.revision).toBe(original.revision)
    rpc({ action: 'recover', root: f.root })
    expect(f.snapshot(first.request.note_id).changes).toBe(3)
    expect(await readFile(objectPath(f.root, original.raw_hash!), 'utf8')).toBe(raw)
  })

  it('adapts a real CardDraft shape and persists original attachments and immutable source once', async () => {
    const f = await fixture(),
      { draft, revision } = await actualDraft()
    const adapted = await adaptCardDraft(draft, f.base.workspaceId, revision)
    rpc({ action: 'register_draft', root: f.root, payload: adapted.payload })
    const plan = await prepareDraftConfirmation(
      adapted.value,
      'confirm-draft',
      { ...f.base, assets: adapted.assets, sources: [revision] },
      preparedAt,
    )
    expect(await f.save(plan)).toHaveProperty('Committed')
    for (let retry = 0; retry < 2; retry++) expect(await f.save(plan)).toHaveProperty('Committed')
    const state = f.snapshot(plan.request.note_id)
    expect(state.cards).toHaveLength(2)
    expect(state.changes).toBe(1)
    expect(state.versions).toBe(1)
    expect(state.drafts).toEqual([
      { id: draft.id, payload: adapted.payload, consumed_by: 'confirm-draft' },
    ])
    const asset = plan.request.acceptance.assets.find((asset) => asset.id === 'original-image-id')!
    expect(asset.id).toBe('original-image-id')
    expect(await readFile(join(f.root, asset.path), 'utf8')).toBe('original image bytes')
    expect(await readFile(objectPath(f.root, asset.hash), 'utf8')).toBe('original image bytes')
    const audio = plan.request.acceptance.assets.find((asset) => asset.id === 'original-audio-id')!
    expect(await readFile(join(f.root, audio.path), 'utf8')).toBe('original audio bytes')
    expect(await readFile(objectPath(f.root, audio.hash), 'utf8')).toBe('original audio bytes')
    expect(await readFile(objectPath(f.root, revision.bodySha256), 'utf8')).toBe(revision.body)
    expect(await readFile(join(f.root, plan.request.path), 'utf8')).toBe(
      new TextDecoder().decode(plan.bytes),
    )
  })

  it('creates a new version for media-only changes without replacing cards or historical bytes', async () => {
    const f = await fixture(),
      { draft } = await actualDraft()
    const firstAsset = await snapshotAsset(draft.uploads[0]!.meta, draft.uploads[0]!.blob, true)
    const raw = rawNote('basic', 'Q', 'A', {
      frontMedia: [{ id: firstAsset.snapshot.id, path: firstAsset.snapshot.path }],
    })
    const first = await prepareAcceptance(
      raw,
      'notes/media.md',
      'first-media',
      { ...f.base, assets: [firstAsset] },
      preparedAt,
    )
    await f.save(first)
    const original = f.snapshot(first.request.note_id)
    const changed = new Blob(['external replacement'], { type: 'image/png' })
    const nextAsset = await snapshotAsset(
      { ...draft.uploads[0]!.meta, size: changed.size },
      changed,
    )
    await writeFile(
      join(f.root, nextAsset.snapshot.path),
      new Uint8Array(await changed.arrayBuffer()),
    )
    const next = await prepareAcceptance(
      raw,
      'notes/media.md',
      'next-media',
      { ...withBefore(f.base, original), assets: [nextAsset] },
      preparedAt,
    )
    expect(await f.save(next)).toHaveProperty('Committed')
    const after = f.snapshot(first.request.note_id)
    expect(after.raw_hash).toBe(original.raw_hash)
    expect(after.revision).not.toBe(original.revision)
    expect(after.versions).toBe(2)
    expect(after.cards.map((card) => card.id)).toEqual(original.cards.map((card) => card.id))
    expect(after.cards.map((card) => card.state_json)).toEqual(
      original.cards.map((card) => card.state_json),
    )
    expect(await readFile(objectPath(f.root, firstAsset.snapshot.hash), 'utf8')).toBe(
      'original image bytes',
    )
    expect(await readFile(objectPath(f.root, nextAsset.snapshot.hash), 'utf8')).toBe(
      'external replacement',
    )
    rpc({ action: 'recover', root: f.root })
    expect(f.snapshot(first.request.note_id).changes).toBe(2)
  })

  it('refuses another workspace or altered document bytes before accepting data', async () => {
    const f = await fixture()
    const plan = await prepareAcceptance(rawNote(), 'notes/a.md', 'mismatch', f.base, preparedAt)
    expect(() =>
      rpc({
        action: 'save',
        root: f.root,
        request: plan.request,
        raw: `${new TextDecoder().decode(plan.bytes)}changed`,
        incoming: f.incoming,
        exit_at: null,
      }),
    ).toThrow('invalid-acceptance-manifest')
    plan.request.acceptance.workspace_id = crypto.randomUUID()
    await expect(f.save(plan)).rejects.toThrow('invalid-acceptance-manifest')
    expect(f.snapshot(plan.request.note_id).changes).toBe(0)
    expect(f.snapshot(plan.request.note_id).cards).toEqual([])
  })

  it('preserves external media created at the planned upload path', async () => {
    const f = await fixture(),
      { draft } = await actualDraft()
    const asset = await snapshotAsset(draft.uploads[0]!.meta, draft.uploads[0]!.blob, true)
    const plan = await prepareAcceptance(
      rawNote('basic', 'Q', 'A', {
        frontMedia: [{ id: asset.snapshot.id, path: asset.snapshot.path }],
      }),
      'notes/media.md',
      'collision',
      { ...f.base, assets: [asset] },
      preparedAt,
    )
    await writeFile(join(f.root, asset.snapshot.path), 'external won the file name')
    expect(await f.save(plan)).toHaveProperty('Attention.committed', false)
    expect(await readFile(join(f.root, asset.snapshot.path), 'utf8')).toBe(
      'external won the file name',
    )
    expect(f.snapshot(plan.request.note_id).changes).toBe(0)
    expect(await readFile(objectPath(f.root, asset.snapshot.hash), 'utf8')).toBe(
      'original image bytes',
    )
  })

  it('handles a legal 8 MiB attachment independently of the 2 MiB text limit', async () => {
    const f = await fixture(),
      { draft } = await actualDraft()
    const blob = new Blob([new Uint8Array(8 * 1024 * 1024).fill(42)], { type: 'image/png' })
    const asset = await snapshotAsset({ ...draft.uploads[0]!.meta, size: blob.size }, blob, true)
    const plan = await prepareAcceptance(
      rawNote('basic', 'Q', 'A', {
        frontMedia: [{ id: asset.snapshot.id, path: asset.snapshot.path }],
      }),
      'notes/large.md',
      'large-image',
      { ...f.base, assets: [asset] },
      preparedAt,
    )
    expect(await f.save(plan)).toHaveProperty('Committed')
    const bytes = await readFile(join(f.root, asset.snapshot.path))
    expect(bytes.byteLength).toBe(blob.size)
    expect(await sha256(bytes)).toBe(asset.snapshot.hash)
  })

  it('keeps the draft unconsumed when media changes after note publication', async () => {
    const f = await fixture(),
      { draft, revision } = await actualDraft()
    const adapted = await adaptCardDraft(draft, f.base.workspaceId, revision)
    rpc({ action: 'register_draft', root: f.root, payload: adapted.payload })
    const plan = await prepareDraftConfirmation(
      adapted.value,
      'media-race',
      { ...f.base, assets: adapted.assets, sources: [revision] },
      preparedAt,
    )
    await f.save(plan, 'FilePublished')
    const asset = plan.request.acceptance.assets.find((asset) => asset.id === 'original-image-id')!
    await writeFile(join(f.root, asset.path), 'late external media')
    const recovered = rpc({ action: 'recover', root: f.root })
    expect(recovered).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          Attention: expect.objectContaining({ committed: false, reason: 'working-media-changed' }),
        }),
      ]),
    )
    expect(f.snapshot(plan.request.note_id).cards).toEqual([])
    expect(f.snapshot(plan.request.note_id).drafts[0]!.consumed_by).toBeNull()
    expect(await readFile(join(f.root, asset.path), 'utf8')).toBe('late external media')
    expect(await readFile(objectPath(f.root, asset.hash), 'utf8')).toBe('original image bytes')
  })

  it('rejects a forged source quote independently of the frontend parser', async () => {
    const f = await fixture(),
      { draft, revision } = await actualDraft()
    const adapted = await adaptCardDraft(draft, f.base.workspaceId, revision)
    rpc({ action: 'register_draft', root: f.root, payload: adapted.payload })
    const plan = await prepareDraftConfirmation(
      adapted.value,
      'source-proof',
      { ...f.base, assets: adapted.assets, sources: [revision] },
      preparedAt,
    )
    plan.request.acceptance.source!.quote = 'forged quote'
    await expect(f.save(plan)).rejects.toThrow('source-quote-mismatch')
    expect(f.snapshot(plan.request.note_id).changes).toBe(0)
    expect(f.snapshot(plan.request.note_id).drafts[0]!.consumed_by).toBeNull()
  })

  it('does not confirm a draft edited after the save plan was prepared', async () => {
    const f = await fixture(),
      { draft, revision } = await actualDraft()
    const adapted = await adaptCardDraft(draft, f.base.workspaceId, revision)
    const plan = await prepareDraftConfirmation(
      adapted.value,
      'stale-draft',
      { ...f.base, assets: adapted.assets, sources: [revision] },
      preparedAt,
    )
    const changed = JSON.stringify({ ...adapted.value, title: 'edited after preparation' })
    rpc({ action: 'register_draft', root: f.root, payload: changed })
    await expect(f.save(plan)).rejects.toThrow('draft-content-changed')
    const state = f.snapshot(plan.request.note_id)
    expect(state.cards).toEqual([])
    expect(state.drafts[0]!.payload).toBe(changed)
    expect(state.drafts[0]!.consumed_by).toBeNull()
  })

  it('checks persisted card identities again instead of trusting a stale plan', async () => {
    const f = await fixture()
    const first = await prepareAcceptance(rawNote(), 'notes/q.md', 'create', f.base, preparedAt)
    await f.save(first)
    const before = f.snapshot(first.request.note_id)
    const next = await prepareAcceptance(
      rawNote('basic', 'edited', 'A'),
      'notes/q.md',
      'stale-card-map',
      withBefore(f.base, before),
      preparedAt,
    )
    next.request.acceptance.expected_cards[0]!.id = 'wrong-card-id'
    await expect(f.save(next)).rejects.toThrow('card-mapping-baseline-changed')
    expect(f.snapshot(first.request.note_id).cards).toEqual(before.cards)
    expect(f.snapshot(first.request.note_id).revision).toBe(before.revision)
  })

  it('deduplicates immutable bytes while keeping different media working files independent', async () => {
    const f = await fixture(),
      { draft } = await actualDraft()
    const upload = draft.uploads[0]!
    const a = await snapshotAsset({ ...upload.meta, id: '🙂' }, upload.blob, true)
    const b = await snapshotAsset({ ...upload.meta, id: '\uE000' }, upload.blob, true)
    const plan = await prepareAcceptance(
      rawNote('basic', 'Q', 'A', {
        frontMedia: [a, b].map((asset) => ({ id: asset.snapshot.id, path: asset.snapshot.path })),
      }),
      'notes/two-media.md',
      'two-media',
      { ...f.base, assets: [a, b] },
      preparedAt,
    )
    expect(a.snapshot.hash).toBe(b.snapshot.hash)
    expect(plan.request.acceptance.assets.map((asset) => asset.id)).toEqual(['🙂', '\uE000'])
    expect(a.snapshot.path).not.toBe(b.snapshot.path)
    expect(await f.save(plan)).toHaveProperty('Committed')
    await writeFile(join(f.root, a.snapshot.path), 'edited only first file')
    expect(await readFile(join(f.root, b.snapshot.path), 'utf8')).toBe('original image bytes')
    expect(await readFile(objectPath(f.root, a.snapshot.hash), 'utf8')).toBe('original image bytes')
  })

  it('does not bind another media identity to an already accepted mutable path', async () => {
    const f = await fixture(),
      { draft } = await actualDraft()
    const first = await snapshotAsset(draft.uploads[0]!.meta, draft.uploads[0]!.blob, true)
    const plan = await prepareAcceptance(
      rawNote('basic', 'Q', 'A', {
        frontMedia: [{ id: first.snapshot.id, path: first.snapshot.path }],
      }),
      'notes/first.md',
      'first',
      { ...f.base, assets: [first] },
      preparedAt,
    )
    await f.save(plan)
    const other = {
      ...first,
      snapshot: { ...first.snapshot, id: 'other-identity' },
      publish: false,
    }
    const next = await prepareAcceptance(
      rawNote('basic', 'Q', 'A', {
        id: 'other-note',
        frontMedia: [{ id: other.snapshot.id, path: other.snapshot.path }],
      }),
      'notes/other.md',
      'other',
      { ...f.base, assets: [other] },
      preparedAt,
    )
    await expect(f.save(next)).rejects.toThrow('asset-path-identity-conflict')
    expect(f.snapshot(next.request.note_id).cards).toEqual([])
    expect(f.snapshot(plan.request.note_id).changes).toBe(1)
  })

  const checkpoints = [
    'ObjectDurable',
    'JournalDurable',
    'ReservationCommitted',
    'AssetPublished(0)',
    'AssetPublished(1)',
    'PublishStarted',
    'FilePublished',
    'PublicationRecorded',
    'BeforeDatabaseCommit',
    'DatabaseCommitted',
    'CompletionRecorded',
  ]
  it.each(checkpoints)(
    'recovers a media-backed CardDraft after process exit at %s',
    async (point) => {
      const f = await fixture(),
        { draft, revision } = await actualDraft()
      const adapted = await adaptCardDraft(draft, f.base.workspaceId, revision)
      rpc({ action: 'register_draft', root: f.root, payload: adapted.payload })
      const plan = await prepareDraftConfirmation(
        adapted.value,
        'confirm',
        { ...f.base, assets: adapted.assets, sources: [revision] },
        preparedAt,
      )
      await f.save(plan, point)
      const before = f.snapshot(plan.request.note_id)
      if (point === 'BeforeDatabaseCommit') {
        expect(before.cards).toEqual([])
        expect(before.drafts[0]!.consumed_by).toBeNull()
      }
      rpc({ action: 'recover', root: f.root })
      const after = f.snapshot(plan.request.note_id)
      const published = checkpoints.indexOf(point) >= checkpoints.indexOf('FilePublished')
      if (published) {
        expect(after.changes).toBe(1)
        expect(after.cards).toHaveLength(2)
        expect(after.drafts[0]!.consumed_by).toBe('confirm')
        expect(await f.save(plan)).toHaveProperty('Committed')
      } else if (point === 'PublishStarted') {
        expect(after.cards).toEqual([])
        expect(after.drafts[0]!.consumed_by).toBeNull()
        expect(await f.save(plan)).toHaveProperty('Attention')
      } else {
        expect(after.cards).toEqual([])
        expect(after.drafts[0]!.consumed_by).toBeNull()
        expect(await f.save(plan)).toHaveProperty('Committed')
      }
      rpc({ action: 'recover', root: f.root })
      expect(f.snapshot(plan.request.note_id).changes).toBe(point === 'PublishStarted' ? 0 : 1)
    },
  )
})
