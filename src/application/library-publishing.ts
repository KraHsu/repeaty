import { z } from 'zod'
import type { PublishingApi, PublishingField, PublishingSnapshot } from '@repeaty/plugin-api'
import type { LibraryContext } from './library-context'
import type { PublishingIdentity } from '../plugins/publishing'
import { parseSourceProperties } from '../core/source-properties'
import { inlineReferences } from '../core/inline-media'
import { sourceContentLinks } from '../core/source-content-links'
import { parseWikiLinks, resolveWikiTarget } from '../core/wiki-links'

const id = z.string().min(1).max(150)
const inputSchema = z.strictObject({
  sourceIds: z
    .array(id)
    .max(1000)
    .refine((ids) => new Set(ids).size === ids.length),
  expectedRevision: z.number().int().nonnegative(),
  publicFields: z.array(z.string().min(1).max(100)).max(64).default([]),
})
const fail = (code: string): never => {
  throw new Error(code)
}
const privateName =
  /^(?:_|repeaty$|id$|path$|url$|title$|draft$|private$|password$|secret$|token$|api[-_]?key$|credential|authorization$|cookie$|__proto__$|constructor$|prototype$)/i
function fields(properties: Record<string, unknown>, names: string[]) {
  const result: Record<string, PublishingField> = Object.create(null)
  for (const key of names) {
    if (privateName.test(key)) fail('publishing-private-field')
    const value = properties[key]
    if (value === undefined || value === null) continue
    if (
      typeof value === 'string' ||
      typeof value === 'boolean' ||
      (typeof value === 'number' && Number.isFinite(value))
    )
      result[key] = value
    else if (
      Array.isArray(value) &&
      value.length <= 100 &&
      value.every((item) => typeof item === 'string')
    )
      result[key] = [...value]
    else fail('publishing-field-type')
  }
  return result
}
/** Explicit frontmatter is never part of a public body, even if it was pasted as ordinary text. */
function publicBody(text: string) {
  const normalized = text.replace(/^\uFEFF/, '')
  if (!/^---\r?\n/.test(normalized)) return { body: text, properties: {} }
  const match = /^---\r?\n([\s\S]*?)^(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/m.exec(normalized)
  if (!match) return fail('publishing-frontmatter-invalid')
  // Use the same bounded YAML reader; managed fields are not public but may occur in pasted docs.
  return {
    body: normalized.slice(match[0].length),
    properties: parseSourceProperties(match[1]!, { allowReserved: true }),
  }
}
function isPrivate(properties: Record<string, unknown>) {
  return (
    ['draft', 'private'].some((key) => properties[key] === true || properties[key] === 'true') ||
    ['private', 'draft'].includes(String(properties.status ?? '').toLowerCase()) ||
    properties.published === false
  )
}
export function createPublishingCommands(context: LibraryContext) {
  return {
    publishingApi(owner: PublishingIdentity): PublishingApi {
      const repository = context.repository
      const snapshots = new Map<
        string,
        {
          revision: number
          expires: number
          assets: Map<string, { mediaId: string; size: number; type: string }>
        }
      >()
      const current = (signal?: AbortSignal) => {
        owner.assertCurrent()
        owner.signal.throwIfAborted()
        signal?.throwIfAborted()
        if (
          !context.ready.value ||
          context.scope.value !== owner.scope ||
          repository !== context.repository
        )
          fail('publishing-library-changed')
      }
      const revision = (expected: number, signal?: AbortSignal) => {
        current(signal)
        if (context.revision !== expected) fail('publishing-library-changed')
      }
      const find = (snapshotId: string) => {
        current()
        const snapshot = snapshots.get(snapshotId)
        if (!snapshot || snapshot.expires < Date.now()) {
          snapshots.delete(snapshotId)
          return fail('publishing-preview-expired')
        }
        revision(snapshot.revision)
        return snapshot
      }
      owner.signal.addEventListener('abort', () => snapshots.clear(), { once: true })
      return {
        list() {
          current()
          return {
            workspaceScope: owner.scope,
            revision: context.revision,
            sources: context.library.value.sources.map(({ id, title, mediaId }) => ({
              id,
              title,
              versionId: mediaId,
            })),
          }
        },
        async prepare(input, signal) {
          const request = inputSchema.parse(input)
          revision(request.expectedRevision, signal)
          const baseline = context.library.value
          const chosen = request.sourceIds.map(
            (id) =>
              baseline.sources.find((source) => source.id === id) ??
              fail('publishing-source-missing'),
          )
          const media = new Map(baseline.media.map((item) => [item.id, item]))
          const assets = new Map<string, { mediaId: string; size: number; type: string }>()
          const result: PublishingSnapshot = {
            id: crypto.randomUUID(),
            workspaceScope: owner.scope,
            revision: request.expectedRevision,
            createdAt: new Date().toISOString(),
            sources: [],
          }
          let bytes = 0
          for (const source of chosen) {
            const rawProperties =
              source.properties ??
              ('readSourceProperties' in repository
                ? await repository.readSourceProperties(source.id)
                : '')
            revision(request.expectedRevision, signal)
            const properties = parseSourceProperties(rawProperties)
            if (isPrivate(properties)) fail('publishing-source-private')
            const text = await context.getSource(source.id, signal ?? owner.signal, source.mediaId)
            revision(request.expectedRevision, signal)
            const { body, properties: embedded } = publicBody(text)
            if (isPrivate(embedded)) fail('publishing-source-private')
            bytes += new TextEncoder().encode(body).byteLength
            if (bytes > 32 * 1024 * 1024) fail('publishing-content-limit')
            const selectedFields = fields({ ...embedded, ...properties }, request.publicFields)
            const targets = sourceContentLinks(source, body, baseline.sources)
            const references = new Set(inlineReferences(body).map((ref) => ref.url))
            const resourceIds = new Map(
              [...targets.resources].map(([ref, value]) => [ref, value.mediaId]),
            )
            for (const item of source.inlineMedia ?? [])
              if (references.has(item.url)) resourceIds.set(item.url, item.mediaId)
            for (const item of source.document?.resources ?? [])
              if (references.has(item.path)) resourceIds.set(item.path, item.mediaId)
            const publicAssets = [...resourceIds].map(([reference, mediaId]) => {
              const meta = media.get(mediaId) ?? fail('publishing-asset-missing')
              // Never silently publish active documents, scripts or unknown file types.
              if (
                !/^(?:image\/(?:png|jpeg|webp|gif|avif)|audio\/(?:mpeg|ogg|wav|x-wav|webm|mp4|flac|aac)|video\/(?:mp4|webm)|application\/pdf)$/.test(
                  meta.type,
                )
              )
                return fail('publishing-asset-type')
              const assetId = crypto.randomUUID()
              assets.set(assetId, { mediaId, size: meta.size, type: meta.type })
              return { id: assetId, reference, size: meta.size, type: meta.type }
            })
            const links = [...targets.links].map(([reference, target]) => ({
              reference,
              sourceId: target.sourceId,
              ...(target.anchor ? { fragment: target.anchor } : {}),
            }))
            for (const link of parseWikiLinks(body)) {
              const matches = resolveWikiTarget(link.target, baseline.sources)
              if (matches.length === 1)
                links.push({ reference: link.target, sourceId: matches[0]!.id })
            }
            result.sources.push({
              id: source.id,
              versionId: source.mediaId,
              title: source.title,
              body,
              format: source.format,
              createdAt: source.createdAt,
              updatedAt: source.acceptedAt ?? source.createdAt,
              fields: selectedFields,
              assets: publicAssets,
              links,
            })
          }
          revision(request.expectedRevision, signal)
          for (const [key, entry] of snapshots)
            if (entry.expires < Date.now()) snapshots.delete(key)
          if (snapshots.size >= 4) fail('publishing-preview-limit')
          snapshots.set(result.id, {
            revision: result.revision,
            expires: Date.now() + 10 * 60_000,
            assets,
          })
          return result
        },
        validate(snapshotId) {
          find(snapshotId)
        },
        async asset(snapshotId, assetId, signal) {
          const snapshot = find(snapshotId)
          current(signal)
          const asset = snapshot.assets.get(assetId) ?? fail('publishing-asset-denied')
          if (asset.size > 25 * 1024 * 1024) fail('publishing-asset-limit')
          const blob = await repository.getMedia(asset.mediaId)
          current(signal)
          if (find(snapshotId) !== snapshot) fail('publishing-preview-expired')
          if (!blob || blob.size !== asset.size || blob.type !== asset.type)
            fail('publishing-asset-missing')
          return blob!
        },
        release(snapshotId) {
          snapshots.delete(snapshotId)
        },
      }
    },
  }
}
