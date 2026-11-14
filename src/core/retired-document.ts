import type { Note } from './model'
import type { RetiredNote } from '../desktop/retirement'
import {
  readWorkspaceMarkdown,
  rewriteWorkspaceDocument,
  type JsonObject,
} from '../workspace/markdown'
import { sha256 } from '../workspace/source-revisions'

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

/** Precompute outside an IndexedDB transaction; hashing and Blob reads cross task boundaries. */
export async function prepareRetiredDocument(
  note: Note,
  prior: RetiredNote['document'],
  getMedia: (id: string) => Promise<Blob | undefined>,
): Promise<RetiredNote['document']> {
  if (!prior) return null
  const parsed = readWorkspaceMarkdown(prior.raw)
  if (
    prior.id !== note.id ||
    parsed.status !== 'managed' ||
    parsed.document.identity.id !== note.id ||
    parsed.document.identity.kind !== 'note'
  )
    throw new Error('invalid-retired-document')
  if ((await sha256(new TextEncoder().encode(prior.raw))) !== prior.hash)
    throw new Error('退役笔记原文的校验和不一致。')
  const document = parsed.document
  const references = new Map(
    [...(document.header.frontMedia ?? []), ...(document.header.backMedia ?? [])].map(
      (reference) => [reference.id, reference],
    ),
  )
  async function attachment(id: string) {
    const previous = references.get(id)
    if (previous) return previous
    const blob = await getMedia(id)
    const extension = blob && extensions[blob.type]
    if (!blob || !extension) throw new Error('退役笔记的附件缺失或格式不支持。')
    const digest = await sha256(new Uint8Array(await blob.arrayBuffer()))
    return { id, path: `assets/${digest}.${extension}` }
  }
  const header = {
    version: 1,
    kind: 'note',
    id: note.id,
    type: note.type,
    format: note.format,
    deckId: note.deckId,
    frontMedia: await Promise.all(note.frontMedia.map(attachment)),
    backMedia: await Promise.all(note.backMedia.map(attachment)),
    ...(note.plugin ? { plugin: note.plugin } : {}),
    ...(document.header.excerpt !== undefined || note.excerpt
      ? { excerpt: note.excerpt ?? null }
      : {}),
    ...(document.header.inlineMedia !== undefined || note.inlineMedia
      ? { inlineMedia: note.inlineMedia ?? [] }
      : {}),
  }
  const raw = rewriteWorkspaceDocument(
    document,
    { repeaty: header, tags: note.tags } as unknown as JsonObject,
    { kind: 'note', front: note.front, back: note.back },
  )
  return { ...prior, raw, hash: await sha256(new TextEncoder().encode(raw)) }
}
