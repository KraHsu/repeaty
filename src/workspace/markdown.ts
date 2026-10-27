import { isAlias, isMap, isScalar, isSeq, parseDocument, stringify } from 'yaml'
import { z } from 'zod'
import { clozes } from '../core/model'
import { pluginDataSchema } from '../plugins/data'

// M0 prototype: no filesystem, repository, UI, or global storage access.
export const MAX_WORKSPACE_TEXT_BYTES = 2 * 1024 * 1024
// Includes legacy plugin JSON (up to 200,000 UTF-16 code units), not just small tags.
export const MAX_FRONTMATTER_BYTES = 1024 * 1024
const MAX_DEPTH = 32
const MAX_NODES = 125_000
const DEFAULT_MARKER = 'repeaty:answer'
export type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject
export interface JsonObject {
  [key: string]: JsonValue
}
export type DocumentKind = 'note' | 'draft' | 'source'
export interface Identity {
  kind: DocumentKind
  id: string
}
export type WorkspaceContent =
  { kind: 'note' | 'draft'; front: string; back: string } | { kind: 'source'; body: string }

const idSchema = z.string().min(1).max(150)
const attachmentSchema = z.object({ id: idSchema, path: z.string().min(1).max(1024) })
const headerSchema = z
  .object({
    version: z.literal(1),
    kind: z.enum(['note', 'draft', 'source']),
    id: idSchema.optional(),
    type: z.enum(['basic', 'reversed', 'cloze', 'plugin']).optional(),
    format: z.enum(['plain', 'markdown']),
    deckId: idSchema.optional(),
    answerMarker: z
      .string()
      .regex(/^repeaty-answer-[A-Za-z0-9-]{1,64}$/)
      .optional(),
    frontMedia: z.array(attachmentSchema).max(8).optional(),
    backMedia: z.array(attachmentSchema).max(8).optional(),
    plugin: pluginDataSchema.optional(),
  })
  .passthrough()
export type WorkspaceHeader = z.infer<typeof headerSchema>
export interface WorkspaceDocument {
  identity: Identity
  header: WorkspaceHeader
  properties: JsonObject
  content: WorkspaceContent
  variants: string[]
  raw: string
  // Retained verbatim, including BOM, comments, unknown properties, and line endings.
  headerRaw: string
  framingEol: '\n' | '\r\n'
}
export type MarkdownResult =
  | { status: 'managed'; document: WorkspaceDocument }
  | { status: 'unmanaged' }
  | { status: 'unregistered'; kind: DocumentKind }
  | { status: 'pending'; reason: string; identity?: Identity }

export class WorkspaceFormatError extends Error {}
function fail(message: string): never {
  throw new WorkspaceFormatError(message)
}
const bytes = (value: string) => new TextEncoder().encode(value).byteLength
const object = (value: JsonValue | undefined): value is JsonObject =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

/** Decode only a bounded JSON value model, without YAML construction or alias expansion. */
function metadata(source: string): JsonObject {
  if (bytes(source) > MAX_FRONTMATTER_BYTES) fail('frontmatter-too-large')
  const doc = parseDocument(source, {
    version: '1.2',
    schema: 'core',
    strict: true,
    uniqueKeys: true,
    stringKeys: true,
    prettyErrors: false,
  })
  if (doc.errors.length || doc.warnings.length) fail('invalid-yaml')
  let nodes = 0
  function value(node: unknown, depth: number): JsonValue {
    if (++nodes > MAX_NODES || depth > MAX_DEPTH) fail('metadata-complexity')
    if (node === null) return null
    if (isAlias(node)) fail('yaml-alias-not-allowed')
    if (!isMap(node) && !isSeq(node) && !isScalar(node)) fail('invalid-yaml-value')
    if (node.tag || ('anchor' in node && node.anchor)) fail('yaml-tag-or-anchor-not-allowed')
    if (isMap(node)) {
      const result: JsonObject = Object.create(null)
      for (const pair of node.items) {
        const key = value(pair.key, depth + 1)
        if (typeof key !== 'string') fail('metadata-key-must-be-string')
        result[key] = value(pair.value, depth + 1)
      }
      return result
    }
    if (isSeq(node)) return node.items.map((item) => value(item, depth + 1))
    if (!isScalar(node)) return fail('invalid-yaml-value')
    const raw: unknown = node.value
    if (
      raw === null ||
      typeof raw === 'string' ||
      typeof raw === 'boolean' ||
      (typeof raw === 'number' && Number.isFinite(raw))
    )
      return raw
    return fail('metadata-value-must-be-json')
  }
  const result = value(doc.contents, 0)
  if (!object(result)) fail('metadata-must-be-object')
  return result
}

const markerText = (marker: string) => `<!-- ${marker} -->`
function markerLines(body: string, marker: string): number[] {
  const result: number[] = []
  let start = 0
  for (;;) {
    const end = body.indexOf('\n', start)
    const line = body.slice(start, end < 0 ? undefined : end)
    if ((line.endsWith('\r') ? line.slice(0, -1) : line) === markerText(marker)) result.push(start)
    if (end < 0) return result
    start = end + 1
  }
}

function cardContent(
  body: string,
  marker: string,
  eol: string,
  kind: 'note' | 'draft',
): WorkspaceContent {
  const matches = markerLines(body, marker)
  if (matches.length !== 1)
    fail(matches.length ? 'ambiguous-answer-boundary' : 'missing-answer-boundary')
  const start = matches[0]!
  const end = start + markerText(marker).length
  if (start && !body.slice(0, start).endsWith(eol)) fail('mixed-boundary-line-endings')
  if (end !== body.length && !body.startsWith(eol, end)) fail('mixed-boundary-line-endings')
  return {
    kind,
    front: body.slice(0, start ? start - eol.length : 0),
    back: body.slice(end === body.length ? end : end + eol.length),
  }
}

function validateContent(header: WorkspaceHeader, content: WorkspaceContent): string[] {
  if (content.kind === 'source') {
    if (content.body.length > 250_000) fail('source-too-long')
    return []
  }
  if (!header.type || !header.deckId) fail('missing-note-metadata')
  if (content.front.length > 10_000 || content.back.length > 10_000) fail('face-too-long')
  if (header.type === 'plugin') {
    if (!header.plugin) fail('missing-plugin-data')
  } else if (header.plugin) fail('unexpected-plugin-data')
  if (content.kind === 'draft') return [] // Incomplete drafts never initialize cards.
  if (!content.front.trim()) fail('empty-question')
  if ((header.type === 'basic' || header.type === 'reversed') && !content.back.trim())
    fail('empty-answer')
  if (header.type === 'cloze') {
    try {
      return [...new Set(clozes(content.front).map((item) => item.number))]
        .sort((a, b) => a - b)
        .map((number) => `cloze:${number}`)
    } catch {
      return fail('invalid-cloze')
    }
  }
  return header.type === 'reversed' ? ['forward', 'reverse'] : ['forward']
}

/** Syntax/identity parsing only. Decks, assets, plugin capability, and source links need acceptance gates. */
export function readWorkspaceMarkdown(raw: string): MarkdownResult {
  let identity: Identity | undefined
  try {
    if (bytes(raw) > MAX_WORKSPACE_TEXT_BYTES) fail('document-too-large')
    const opening = /^(?:\uFEFF)?---(\r?\n)/.exec(raw)
    if (!opening) return { status: 'unmanaged' }
    const close = /^---(\r?\n|$)/gm
    close.lastIndex = opening[0].length
    const closing = close.exec(raw)
    if (!closing) fail('unclosed-frontmatter')
    const headerEnd = closing.index + closing[0].length
    const properties = metadata(raw.slice(opening[0].length, closing.index))
    if (!Object.hasOwn(properties, 'repeaty')) return { status: 'unmanaged' }
    if (object(properties.repeaty)) {
      const candidate = properties.repeaty
      if (
        (candidate.kind === 'note' || candidate.kind === 'draft' || candidate.kind === 'source') &&
        typeof candidate.id === 'string' &&
        idSchema.safeParse(candidate.id).success
      ) {
        identity = { kind: candidate.kind, id: candidate.id }
      }
    }
    const parsed = headerSchema.safeParse(properties.repeaty)
    if (!parsed.success) fail('invalid-repeaty-metadata')
    const header = parsed.data
    if (!header.id) return { status: 'unregistered', kind: header.kind }
    const tags = z.array(z.string().min(1).max(40)).max(20)
    if (properties.tags !== undefined && !tags.safeParse(properties.tags).success)
      fail('invalid-tags')
    const framingEol = (closing[1] || opening[1]) as '\n' | '\r\n'
    const body = raw.slice(headerEnd)
    const content: WorkspaceContent =
      header.kind === 'source'
        ? { kind: 'source', body }
        : cardContent(body, header.answerMarker ?? DEFAULT_MARKER, framingEol, header.kind)
    const variants = validateContent(header, content)
    return {
      status: 'managed',
      document: {
        identity: identity!,
        header,
        properties,
        content,
        variants,
        raw,
        headerRaw: raw.slice(0, headerEnd),
        framingEol,
      },
    }
  } catch (error) {
    return {
      status: 'pending',
      reason: error instanceof WorkspaceFormatError ? error.message : 'invalid-yaml',
      ...(identity ? { identity } : {}),
    }
  }
}

/** Fresh files use deterministic, collision-free framing; payload text is never trimmed. */
export function createWorkspaceMarkdown(properties: JsonObject, content: WorkspaceContent): string {
  const copy = structuredClone(properties)
  if (!object(copy.repeaty)) fail('invalid-repeaty-metadata')
  if (copy.repeaty.kind !== content.kind) fail('content-kind-mismatch')
  let body: string
  if (content.kind === 'source') body = content.body
  else {
    let marker =
      typeof copy.repeaty.answerMarker === 'string' ? copy.repeaty.answerMarker : DEFAULT_MARKER
    for (
      let suffix = 1;
      markerLines(content.front, marker).length || markerLines(content.back, marker).length;
      suffix++
    ) {
      marker = `repeaty-answer-${suffix}`
    }
    if (marker !== DEFAULT_MARKER) copy.repeaty.answerMarker = marker
    body = `${content.front}\n${markerText(marker)}\n${content.back}`
  }
  const result = `---\n${stringify(copy, { lineWidth: 0 })}---\n${body}`
  const parsed = readWorkspaceMarkdown(result)
  if (parsed.status !== 'managed') fail(parsed.status === 'pending' ? parsed.reason : parsed.status)
  return result
}

/** Change only the body. Metadata edits/CST patching belong to the later directory editor. */
export function rewriteWorkspaceContent(
  document: WorkspaceDocument,
  content: WorkspaceContent,
): string {
  if (document.content.kind !== content.kind) fail('content-kind-mismatch')
  if (JSON.stringify(document.content) === JSON.stringify(content)) return document.raw
  let body: string
  if (content.kind === 'source') body = content.body
  else {
    const marker = document.header.answerMarker ?? DEFAULT_MARKER
    if (markerLines(content.front, marker).length || markerLines(content.back, marker).length)
      fail('answer-marker-collision')
    body = `${content.front}${document.framingEol}${markerText(marker)}${document.framingEol}${content.back}`
  }
  const result = document.headerRaw + body
  const parsed = readWorkspaceMarkdown(result)
  if (parsed.status !== 'managed') fail(parsed.status === 'pending' ? parsed.reason : parsed.status)
  return result
}

/** Strict UTF-8 IO: malformed bytes or unpaired JS surrogates must not be silently replaced. */
export function readWorkspaceBytes(input: Uint8Array): MarkdownResult {
  if (input.byteLength > MAX_WORKSPACE_TEXT_BYTES)
    return { status: 'pending', reason: 'document-too-large' }
  try {
    return readWorkspaceMarkdown(
      new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(input),
    )
  } catch {
    return { status: 'pending', reason: 'invalid-utf8' }
  }
}
export function workspaceBytes(raw: string): Uint8Array {
  const result = new TextEncoder().encode(raw)
  if (new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(result) !== raw)
    fail('invalid-unicode')
  return result
}

/** Register an external note without rewriting its body or discarding YAML comments. */
export function registerWorkspaceNote(
  raw: string,
  defaults: {
    id: string
    deckId: string
    type: 'basic' | 'reversed' | 'cloze' | 'plugin'
    format: 'plain' | 'markdown'
  },
): WorkspaceDocument {
  return registerWorkspaceFile(raw, { kind: 'note', ...defaults })
}
export function registerWorkspaceSource(
  raw: string,
  defaults: { id: string; format: 'plain' | 'markdown' },
): WorkspaceDocument {
  return registerWorkspaceFile(raw, { kind: 'source', ...defaults })
}
function registerWorkspaceFile(
  raw: string,
  defaults: {
    kind: 'note' | 'source'
    id: string
    format: 'plain' | 'markdown'
    type?: string
    deckId?: string
  },
): WorkspaceDocument {
  const existing = readWorkspaceMarkdown(raw)
  if (existing.status === 'pending') fail(existing.reason)
  if (
    existing.status === 'managed' &&
    (existing.document.identity.kind !== defaults.kind ||
      existing.document.identity.id !== defaults.id)
  )
    fail('not-a-note')
  const opening = /^(?:\uFEFF)?---(\r?\n)/.exec(raw)
  const eol = (opening?.[1] ?? (raw.includes('\r\n') ? '\r\n' : '\n')) as '\n' | '\r\n'
  let body = raw.replace(/^\uFEFF/, ''),
    header: string
  const values = { version: 1, ...defaults }
  if (opening) {
    const close = /^---(\r?\n|$)/gm
    close.lastIndex = opening[0].length
    const closing = close.exec(raw)
    if (!closing) fail('unclosed-frontmatter')
    const source = raw.slice(opening[0].length, closing.index)
    metadata(source)
    const yaml = parseDocument(source, { schema: 'core', uniqueKeys: true })
    const previous = yaml.get('repeaty', true)
    if (previous !== undefined && !isMap(previous)) fail('invalid-repeaty-metadata')
    if (previous === undefined) yaml.set('repeaty', yaml.createNode({}))
    let changed = previous === undefined
    for (const [key, value] of Object.entries(values)) {
      if (yaml.getIn(['repeaty', key]) !== value) {
        yaml.setIn(['repeaty', key], value)
        changed = true
      }
    }
    header = changed
      ? `${raw.startsWith('\uFEFF') ? '\uFEFF' : ''}---${eol}${yaml.toString({ lineWidth: 0 }).replace(/\r?\n/g, eol)}---${eol}`
      : raw.slice(0, closing.index + closing[0].length)
    body = raw.slice(closing.index + closing[0].length)
  } else
    header = `${raw.startsWith('\uFEFF') ? '\uFEFF' : ''}---${eol}${stringify({ repeaty: values }, { lineWidth: 0 }).replace(/\r?\n/g, eol)}---${eol}`
  const preflight = readWorkspaceMarkdown(header + body)
  if (
    defaults.type === 'cloze' &&
    preflight.status === 'pending' &&
    preflight.reason === 'missing-answer-boundary'
  )
    body += `${eol}<!-- repeaty:answer -->${eol}`
  const result = readWorkspaceMarkdown(header + body)
  if (result.status !== 'managed') fail(result.status === 'pending' ? result.reason : result.status)
  return result.document
}

/** Change known metadata and faces together, retaining comments and unrelated YAML fields. */
export function rewriteWorkspaceDocument(
  document: WorkspaceDocument,
  properties: JsonObject,
  content: WorkspaceContent,
): string {
  const opening = /^(?:\uFEFF)?---(\r?\n)/.exec(document.headerRaw)!
  const closing = /^---(\r?\n|$)/gm
  closing.lastIndex = opening[0].length
  const end = closing.exec(document.headerRaw)!
  const yaml = parseDocument(document.headerRaw.slice(opening[0].length, end.index), {
    schema: 'core',
    uniqueKeys: true,
  })
  for (const [key, value] of Object.entries(properties)) {
    if (key === 'repeaty' && object(value))
      for (const [field, item] of Object.entries(value)) yaml.setIn(['repeaty', field], item)
    else yaml.set(key, value)
  }
  if (object(properties.repeaty) && properties.repeaty.type !== 'plugin')
    yaml.deleteIn(['repeaty', 'plugin'])
  const eol = document.framingEol
  let body: string
  if (content.kind === 'source') body = content.body
  else {
    let marker = document.header.answerMarker ?? DEFAULT_MARKER
    for (
      let suffix = 1;
      markerLines(content.front, marker).length || markerLines(content.back, marker).length;
      suffix++
    )
      marker = `repeaty-answer-${suffix}`
    if (marker !== DEFAULT_MARKER) yaml.setIn(['repeaty', 'answerMarker'], marker)
    body = `${content.front}${eol}${markerText(marker)}${eol}${content.back}`
  }
  const result = `${document.raw.startsWith('\uFEFF') ? '\uFEFF' : ''}---${eol}${yaml.toString({ lineWidth: 0 }).replace(/\r?\n/g, eol)}---${eol}${body}`
  const parsed = readWorkspaceMarkdown(result)
  if (parsed.status !== 'managed') fail(parsed.status === 'pending' ? parsed.reason : parsed.status)
  return result
}
