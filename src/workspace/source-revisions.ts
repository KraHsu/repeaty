import { workspaceBytes } from './markdown'
import { characterBoundary } from '../core/source-data'

export interface SourceRevision {
  readonly version: 1
  readonly sourceId: string
  readonly id: string
  readonly format: 'plain' | 'markdown'
  readonly body: string
  readonly bodySha256: string
}
export interface SourceQuote {
  readonly sourceId: string
  readonly revisionId: string
  readonly start: number
  readonly end: number
  readonly quote: string
}

export async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** Immutable, deterministic fixture DTO; not yet a persisted SourceRevision store. */
export async function createSourceRevision(
  sourceId: string,
  format: 'plain' | 'markdown',
  body: string,
): Promise<SourceRevision> {
  if (!sourceId || sourceId.length > 100 || body.length > 250_000)
    throw new Error('invalid-source-revision')
  const id = `sha256:${await sha256(workspaceBytes(JSON.stringify([1, sourceId, format, body])))}`
  return Object.freeze({
    version: 1,
    sourceId,
    id,
    format,
    body,
    bodySha256: await sha256(workspaceBytes(body)),
  })
}

export function quoteSource(revision: SourceRevision, start: number, end: number): SourceQuote {
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end <= start ||
    end > revision.body.length ||
    end - start > 10_000 ||
    characterBoundary(revision.body, start) !== start ||
    characterBoundary(revision.body, end) !== end
  )
    throw new Error('invalid-source-range')
  return Object.freeze({
    sourceId: revision.sourceId,
    revisionId: revision.id,
    start,
    end,
    quote: revision.body.slice(start, end),
  })
}

export function readSourceQuote(revision: SourceRevision, quote: SourceQuote): string {
  if (revision.sourceId !== quote.sourceId || revision.id !== quote.revisionId)
    throw new Error('source-revision-mismatch')
  if (quoteSource(revision, quote.start, quote.end).quote !== quote.quote)
    throw new Error('source-quote-mismatch')
  return quote.quote
}

/** Editing an excerpt produces derived text, never a false verbatim span in the current parent. */
export function editSourceQuote(original: SourceQuote, body: string) {
  if (!body.trim() || body.length > 10_000) throw new Error('invalid-derived-excerpt')
  return Object.freeze({
    kind: 'edited' as const,
    body,
    derivedFrom: Object.freeze({ ...original }),
  })
}
