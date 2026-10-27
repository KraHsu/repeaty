import { z } from 'zod'
import { mediaPath, inlineReferences as inlineMedia } from '../core/inline-media'
export { mediaPath } from '../core/inline-media'
import { cardDraftSchema, type CardDraft } from '../core/card-draft-data'
import { MAX_MEDIA_BYTES, mediaSchema, newCard } from '../core/model'
import { planVariants, type VariantRecord } from './changes'
import {
  createWorkspaceMarkdown,
  readWorkspaceMarkdown,
  workspaceBytes,
  type JsonObject,
} from './markdown'
import {
  createSourceRevision,
  quoteSource,
  readSourceQuote,
  sha256,
  type SourceRevision,
} from './source-revisions'

export interface AssetSnapshot {
  id: string
  path: string
  hash: string
  media_type: string
  size: number
  name: string
  created_at: string
}
export interface SourceSnapshot {
  source_id: string
  revision_id: string
  format: 'plain' | 'markdown'
  body_hash: string
  size: number
  start: number
  end: number
  quote: string
}
export interface NoteAcceptance {
  version: 1
  workspace_id: string
  deck_id: string
  note_type: 'basic' | 'reversed' | 'cloze' | 'plugin'
  raw_hash: string
  revision: string
  expected_revision: string | null
  variants: string[]
  expected_cards: { id: string; variant: string; lifecycle: 'active' | 'retired' }[]
  assets: AssetSnapshot[]
  publish_assets: string[]
  source: SourceSnapshot | null
  draft_hash: string | null
}
export interface NativeSaveRequest {
  operation_id: string
  note_id: string
  path: string
  expected_hash: string | null
  draft_id: string | null
  new_cards: { id: string; variant: string; state_json: string }[]
  acceptance: NoteAcceptance
}
export interface AvailableAsset {
  snapshot: AssetSnapshot
  blob: Blob
  publish: boolean
}
export interface AcceptanceContext {
  workspaceId: string
  decks: ReadonlySet<string>
  assets: readonly AvailableAsset[]
  sources: readonly SourceRevision[]
  installedPlugins: ReadonlySet<string>
  before?: { rawHash: string; revision: string; cards: readonly VariantRecord[] }
}
export interface PreparedAcceptance {
  request: NativeSaveRequest
  bytes: Uint8Array
  objects: Map<string, Blob>
  warnings: string[]
}
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/)
const originSchema = z.strictObject({
  sourceId: z.string().min(1).max(100),
  revisionId: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  start: z.number().int().nonnegative(),
  end: z.number().int().positive(),
  quote: z.string().min(1).max(10_000),
})
const extensions: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
  'audio/webm': 'webm',
  'audio/flac': 'flac',
  'audio/aac': 'aac',
}
export async function snapshotAsset(
  meta: z.infer<typeof mediaSchema>,
  blob: Blob,
  publish = false,
): Promise<AvailableAsset> {
  mediaSchema.parse(meta) // Validate without applying its normalization to stored metadata.
  if (
    !extensions[meta.type] ||
    blob.size !== meta.size ||
    blob.type !== meta.type ||
    !blob.size ||
    blob.size > MAX_MEDIA_BYTES
  )
    throw new Error('invalid-media-body')
  const hash = await sha256(new Uint8Array(await blob.arrayBuffer()))
  return {
    snapshot: {
      id: meta.id,
      path: `assets/${await sha256(workspaceBytes(meta.id))}.${extensions[meta.type]}`,
      hash,
      media_type: meta.type,
      size: meta.size,
      name: meta.name,
      created_at: meta.createdAt,
    },
    blob,
    publish,
  }
}

/** Shared canonical tuple: also recomputed by Rust before recording a content version. */
export async function acceptedRevision(
  noteId: string,
  rawHash: string,
  assets: readonly AssetSnapshot[],
): Promise<string> {
  return sha256(
    workspaceBytes(
      JSON.stringify([
        1,
        noteId,
        rawHash,
        assets.map((asset) => [asset.id, asset.path, asset.hash, asset.media_type, asset.size]),
      ]),
    ),
  )
}

export async function prepareAcceptance(
  raw: string,
  path: string,
  operationId: string,
  context: AcceptanceContext,
  now: Date,
  confirmation?: { id: string; hash: string },
): Promise<PreparedAcceptance> {
  z.uuid().parse(context.workspaceId)
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(operationId)) throw new Error('invalid-operation-id')
  if (!/^notes\/[A-Za-z0-9_-]{1,64}\.md$/.test(path)) throw new Error('invalid-note-path')
  if (confirmation && context.before) throw new Error('draft-confirmation-must-create-a-note')
  const parsed = readWorkspaceMarkdown(raw)
  if (
    parsed.status !== 'managed' ||
    parsed.document.content.kind !== 'note' ||
    !parsed.document.header.type ||
    !parsed.document.header.deckId
  )
    throw new Error('invalid-note-document')
  const { document } = parsed
  if (!context.decks.has(document.header.deckId!)) throw new Error('unknown-deck')
  const availableById = new Map(context.assets.map((asset) => [asset.snapshot.id, asset]))
  const availableByPath = new Map(context.assets.map((asset) => [asset.snapshot.path, asset]))
  if (
    availableById.size !== context.assets.length ||
    availableByPath.size !== context.assets.length
  )
    throw new Error('duplicate-media-identity-or-path')
  const used = new Map<string, AvailableAsset>()
  const warnings = new Set<string>()
  for (const ref of [...(document.header.frontMedia ?? []), ...(document.header.backMedia ?? [])]) {
    const asset = availableById.get(ref.id)
    if (!asset || asset.snapshot.path !== ref.path) throw new Error('missing-or-mismatched-media')
    used.set(ref.id, asset)
  }
  if (document.header.format === 'markdown' && document.content.kind === 'note') {
    for (const ref of [
      ...inlineMedia(document.content.front),
      ...inlineMedia(document.content.back),
    ]) {
      if (ref.media && /^https?:\/\//i.test(ref.url)) warnings.add('external-media-not-snapshotted')
      const resolved = mediaPath(ref.url, path)
      if (resolved === undefined) continue
      if (!resolved.startsWith('assets/')) {
        if (ref.media) throw new Error('media-must-be-in-assets')
        continue
      }
      const asset = availableByPath.get(resolved)
      if (!asset) throw new Error('missing-inline-media')
      used.set(asset.snapshot.id, asset)
    }
  }
  const assets = [...used.values()].sort((a, b) =>
    a.snapshot.id < b.snapshot.id ? -1 : a.snapshot.id > b.snapshot.id ? 1 : 0,
  )
  if (
    assets.length > 64 ||
    assets.reduce((size, asset) => size + asset.snapshot.size, 0) > 128 * 1024 * 1024
  )
    throw new Error('media-bundle-too-large')
  const objects = new Map<string, Blob>()
  for (const asset of assets) {
    hashSchema.parse(asset.snapshot.hash)
    if (
      !extensions[asset.snapshot.media_type] ||
      asset.snapshot.size <= 0 ||
      asset.snapshot.size > MAX_MEDIA_BYTES ||
      !/^assets\/[A-Za-z0-9_-]{1,64}\.(png|jpg|jpeg|webp|gif|mp3|wav|ogg|m4a|webm|flac|aac)$/.test(
        asset.snapshot.path,
      ) ||
      asset.blob.size !== asset.snapshot.size ||
      asset.blob.type !== asset.snapshot.media_type ||
      (await sha256(new Uint8Array(await asset.blob.arrayBuffer()))) !== asset.snapshot.hash
    )
      throw new Error('changed-media-body')
    objects.set(asset.snapshot.hash, asset.blob)
  }
  let source: SourceSnapshot | null = null
  if (document.header.origin !== undefined) {
    const origin = originSchema.parse(document.header.origin)
    const revision = context.sources.find(
      (item) => item.sourceId === origin.sourceId && item.id === origin.revisionId,
    )
    const verified =
      revision && (await createSourceRevision(revision.sourceId, revision.format, revision.body))
    if (
      !revision ||
      !verified ||
      verified.id !== revision.id ||
      verified.bodySha256 !== revision.bodySha256
    )
      throw new Error('missing-source-revision')
    readSourceQuote(revision, origin)
    const body = workspaceBytes(revision.body)
    source = {
      source_id: revision.sourceId,
      revision_id: revision.id,
      format: revision.format,
      body_hash: revision.bodySha256,
      size: body.byteLength,
      start: origin.start,
      end: origin.end,
      quote: origin.quote,
    }
    objects.set(source.body_hash, new Blob([Uint8Array.from(body).buffer], { type: 'text/plain' }))
  }
  const known = context.before?.cards ?? []
  const plan = planVariants(known, document.variants)
  const newCards = await Promise.all(
    plan.create.map(async (variant) => {
      const card = newCard(document.identity.id, variant, now)
      card.id = `card-${await sha256(workspaceBytes(JSON.stringify([context.workspaceId, document.identity.id, variant])))}`
      return { id: card.id, variant, state_json: JSON.stringify(card) }
    }),
  )
  const bytes = workspaceBytes(raw),
    rawHash = await sha256(bytes)
  const request: NativeSaveRequest = {
    operation_id: operationId,
    note_id: document.identity.id,
    path,
    expected_hash: context.before?.rawHash ?? null,
    draft_id: confirmation?.id ?? null,
    new_cards: newCards,
    acceptance: {
      version: 1,
      workspace_id: context.workspaceId,
      deck_id: document.header.deckId!,
      note_type: document.header.type!,
      raw_hash: rawHash,
      revision: await acceptedRevision(
        document.identity.id,
        rawHash,
        assets.map((asset) => asset.snapshot),
      ),
      expected_revision: context.before?.revision ?? null,
      variants: document.variants,
      expected_cards: known.map((card) => ({
        id: card.cardId,
        variant: card.variant,
        lifecycle: card.lifecycle,
      })),
      assets: assets.map((asset) => ({ ...asset.snapshot })),
      publish_assets: assets.filter((asset) => asset.publish).map((asset) => asset.snapshot.id),
      source,
      draft_hash: confirmation?.hash ?? null,
    },
  }
  if (confirmation) hashSchema.parse(confirmation.hash)
  if (context.before) {
    hashSchema.parse(context.before.rawHash)
    hashSchema.parse(context.before.revision)
  }
  if (document.header.plugin && !context.installedPlugins.has(document.header.plugin.id))
    warnings.add('plugin-unavailable')
  return {
    request,
    bytes,
    objects,
    warnings: [...warnings],
  }
}

export interface WorkspaceDraft {
  version: 1
  id: string
  workspace_id: string
  position: number
  title: string
  received_at: string
  updated_at: string
  source_media_id: string
  raw: string
  assets: AssetSnapshot[]
}

/** Explicit legacy-to-workspace DTO. Local scopes/selection IDs never become workspace authority. */
export async function adaptCardDraft(
  draft: CardDraft,
  workspaceId: string,
  revision: SourceRevision,
) {
  cardDraftSchema.parse(draft)
  z.uuid().parse(workspaceId)
  const quote = quoteSource(revision, draft.excerpt.start, draft.excerpt.end)
  if (quote.sourceId !== draft.excerpt.sourceId || quote.quote !== draft.excerpt.quote)
    throw new Error('draft-source-revision-mismatch')
  const assets: AvailableAsset[] = []
  for (const upload of draft.uploads)
    assets.push(await snapshotAsset(upload.meta, upload.blob, true))
  const byId = new Map(assets.map((asset) => [asset.snapshot.id, asset.snapshot]))
  const references = (ids: string[]) => ids.map((id) => ({ id, path: byId.get(id)!.path }))
  const properties: JsonObject = {
    repeaty: {
      version: 1,
      kind: 'draft',
      id: draft.id,
      type: draft.input.type,
      format: draft.input.format,
      deckId: draft.deckId,
      frontMedia: references(draft.input.frontMedia),
      backMedia: references(draft.input.backMedia),
      origin: { ...quote },
    },
    tags: [...draft.input.tags],
  }
  const value: WorkspaceDraft = {
    version: 1,
    id: draft.id,
    workspace_id: workspaceId,
    position: draft.position,
    title: draft.title,
    received_at: draft.receivedAt,
    updated_at: draft.updatedAt,
    source_media_id: draft.mediaId,
    raw: createWorkspaceMarkdown(properties, {
      kind: 'draft',
      front: draft.input.front,
      back: draft.input.back,
    }),
    assets: assets.map((asset) => asset.snapshot),
  }
  return { value, payload: JSON.stringify(value), assets }
}

export async function prepareDraftConfirmation(
  draft: WorkspaceDraft,
  operationId: string,
  context: AcceptanceContext,
  now: Date,
): Promise<PreparedAcceptance> {
  if (draft.workspace_id !== context.workspaceId || context.before)
    throw new Error('draft-workspace-mismatch')
  const parsed = readWorkspaceMarkdown(draft.raw)
  if (
    parsed.status !== 'managed' ||
    parsed.document.identity.kind !== 'draft' ||
    parsed.document.identity.id !== draft.id ||
    parsed.document.content.kind !== 'draft'
  )
    throw new Error('invalid-workspace-draft')
  const noteId = `note-${await sha256(workspaceBytes(JSON.stringify([context.workspaceId, 'draft', draft.id])))}`
  const properties = structuredClone(parsed.document.properties)
  const header = properties.repeaty as JsonObject
  header.id = noteId
  header.kind = 'note'
  const raw = createWorkspaceMarkdown(properties, { ...parsed.document.content, kind: 'note' })
  return prepareAcceptance(
    raw,
    `notes/${await sha256(workspaceBytes(noteId))}.md`,
    operationId,
    context,
    now,
    { id: draft.id, hash: await sha256(workspaceBytes(JSON.stringify(draft))) },
  )
}
