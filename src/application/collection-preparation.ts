import type { MaterialImportCandidate } from '@repeaty/plugin-api'
import { candidateSchema, validateTree } from './library-materials'
import { prepareSource } from '../core/sources'
import { mediaSchema, MAX_MEDIA_BYTES, type MediaUpload } from '../core/model'
import type { Source } from '../core/source-data'

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(',')}}`
  return JSON.stringify(value)
}
export async function digest(value: string | Blob): Promise<string> {
  const bytes =
    typeof value === 'string' ? new TextEncoder().encode(value) : await value.arrayBuffer()
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('')
}
export function mediaUpload(blob: Blob, name: string): MediaUpload {
  const owned = blob.type ? blob : new Blob([blob], { type: 'application/octet-stream' })
  return {
    blob: owned,
    meta: mediaSchema.parse({
      id: crypto.randomUUID(),
      name: name.slice(0, 200),
      type: owned.type,
      size: owned.size,
      createdAt: new Date().toISOString(),
    }),
  }
}
export interface PreparedCollectionSource {
  source: Source
  assets: MediaUpload[]
  key: string
  sourceName: string
  fingerprint: string
}
/** Pure staging: no bytes reach a repository until the containing transaction is confirmed. */
export async function prepareCollectionFile(
  file: File,
  raw: readonly MaterialImportCandidate[],
  providerId: string,
  signal: AbortSignal,
): Promise<PreparedCollectionSource[]> {
  signal.throwIfAborted()
  if (!raw.length || raw.length > 1000) throw new Error('每批最多包含 1000 份材料。')
  const candidates = raw.map((value) => candidateSchema.parse(value))
  validateTree(candidates)
  const original = mediaUpload(file, file.name)
  const fileHash = await digest(file)
  const prepared: PreparedCollectionSource[] = []
  for (const candidate of candidates) {
    signal.throwIfAborted()
    const snapshot = prepareSource({
      title: candidate.title,
      content: candidate.text,
      url: candidate.url ?? '',
      format: candidate.format,
    })
    const resources: MediaUpload[] = []
    const resourceRefs: { path: string; mediaId: string }[] = []
    const resourceHashes: { path: string; hash: string; type: string }[] = []
    for (const resource of candidate.resources ?? []) {
      if (!resource.blob.size || resource.blob.size > MAX_MEDIA_BYTES)
        throw new Error('关联资源不能超过 10 MB。')
      const asset = mediaUpload(resource.blob, resource.path.split('/').at(-1)!)
      resources.push(asset)
      resourceRefs.push({ path: resource.path, mediaId: asset.meta.id })
      resourceHashes.push({
        path: resource.path,
        hash: await digest(resource.blob),
        type: resource.blob.type,
      })
    }
    const fingerprint = await digest(
      canonical({
        provider: providerId,
        fileHash,
        candidate: {
          ...candidate,
          resources: resourceHashes.sort((a, b) => a.path.localeCompare(b.path)),
          studySequence: candidate.studySequence
            ? { ...candidate.studySequence, mode: undefined }
            : undefined,
        },
      }),
    )
    snapshot.source.document = {
      schemaVersion: 1,
      providerId,
      readerId: candidate.readerId,
      format: candidate.documentFormat,
      originalMediaId: original.meta.id,
      importKey: fingerprint,
      path: candidate.documentPath,
      data: candidate.documentData,
      container: candidate.container,
      resources: resourceRefs.length ? resourceRefs : undefined,
    }
    prepared.push({
      source: snapshot.source,
      assets: [snapshot.asset, original, ...resources],
      key: candidate.key,
      sourceName: file.webkitRelativePath || file.name,
      fingerprint,
    })
  }
  candidates.forEach((candidate, index) => {
    const entry = prepared[index]!
    if (candidate.parentKey)
      entry.source.parentSourceId =
        prepared[candidates.findIndex((v) => v.key === candidate.parentKey)]!.source.id
    if (candidate.studySequence)
      entry.source.studySequence = {
        groupId:
          prepared[candidates.findIndex((v) => v.key === candidate.studySequence!.groupKey)]!.source
            .id,
        index: candidate.studySequence.index,
        mode: candidate.studySequence.mode,
        completed: false,
      }
  })
  signal.throwIfAborted()
  return prepared
}
