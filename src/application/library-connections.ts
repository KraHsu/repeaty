import { z } from 'zod'
import type { SourceConnectorSnapshot } from '@repeaty/plugin-api'
import type { LibraryContext } from './library-context'
import { canonical, digest, mediaUpload } from './collection-preparation'
import {
  sourceCandidateSchema,
  sourceConnectionSchema,
  type SourceConnection,
  type SourceCandidate,
} from '../core/collection-data'
import { materialPathSchema } from '../core/material-data'
import { prepareSource } from '../core/sources'
import { sourceSchema } from '../core/source-data'
import { MAX_MEDIA_BYTES, pruneMedia, type MediaUpload } from '../core/model'

export interface ConnectionMutation {
  expectedRevision: number
}
export interface SourceConnectionApi {
  snapshot(): {
    revision: number
    workspaceScope: string
    connections: SourceConnection[]
    candidates: SourceCandidate[]
  }
  save(
    request: ConnectionMutation & {
      id?: string
      pluginId: string
      connectorId: string
      title: string
      mode: 'import' | 'index'
      settings?: Record<string, unknown>
      intervalHours?: SourceConnection['intervalHours']
      status?: SourceConnection['status']
    },
  ): Promise<SourceConnection>
  markChecked(request: { connectionId: string; generation: number }): Promise<void>
  stage(
    request: { connectionId: string; generation: number; snapshot: SourceConnectorSnapshot },
    signal?: AbortSignal,
  ): Promise<{ candidates: number }>
  resolve(
    request: ConnectionMutation & {
      candidateId: string
      action: 'accept' | 'keep'
      targetSourceId?: string
      expectedMediaId?: string
    },
  ): Promise<{ sourceId?: string }>
  readCandidate(id: string): Promise<string>
}
const itemSchema = z.strictObject({
  key: z.string().min(1).max(2048),
  title: z.string().trim().min(1).max(160),
  text: z.string().min(1).max(250000),
  format: z.enum(['plain', 'markdown']),
  url: z
    .string()
    .max(2048)
    .regex(/^(?:https?:\/\/[^\s]+)?$/)
    .optional(),
  path: materialPathSchema.optional(),
  resources: z
    .array(z.strictObject({ path: materialPathSchema, blob: z.instanceof(Blob) }))
    .max(2000)
    .optional(),
  links: sourceCandidateSchema.shape.links,
  original: z.unknown().optional(),
})
function bindingKey(connectionId: string, key: string) {
  return JSON.stringify([connectionId, key])
}

export function createSourceConnectionCommands(context: LibraryContext) {
  return {
    sourceConnectionApi(): SourceConnectionApi {
      const scope = context.scope.value,
        repository = context.repository
      const scans = new Set<string>()
      const check = (expected?: number) => {
        if (
          !context.ready.value ||
          context.scope.value !== scope ||
          context.repository !== repository
        )
          throw new Error('学习库已变化，请重新操作。')
        if (expected !== undefined && context.revision !== expected)
          throw new Error('学习库已变化，请重新确认。')
      }
      const connection = (id: string, generation?: number) => {
        check()
        const value = context.library.value.sourceConnections.find((c) => c.id === id)
        if (
          !value ||
          value.status !== 'connected' ||
          (generation !== undefined && value.generation !== generation)
        )
          throw new Error('来源已断开或连接配置已变化。')
        return value
      }
      return {
        snapshot() {
          check()
          return {
            revision: context.revision,
            workspaceScope: scope,
            connections: structuredClone(context.library.value.sourceConnections),
            candidates: structuredClone(context.library.value.sourceCandidates),
          }
        },
        async save(request) {
          check(request.expectedRevision)
          const old = request.id
            ? context.library.value.sourceConnections.find((c) => c.id === request.id)
            : undefined
          if (request.id && !old) throw new Error('来源连接已不存在。')
          if (
            old &&
            (old.pluginId !== request.pluginId ||
              old.connectorId !== request.connectorId ||
              old.mode !== request.mode)
          )
            throw new Error('不能更改已有连接的提供方或读取方式。')
          const next = sourceConnectionSchema.parse({
            id: old?.id ?? crypto.randomUUID(),
            pluginId: request.pluginId,
            connectorId: request.connectorId,
            title: request.title,
            mode: request.mode,
            settings: request.settings ?? old?.settings ?? {},
            intervalHours: request.intervalHours ?? old?.intervalHours ?? 0,
            status: request.status ?? old?.status ?? 'connected',
            createdAt: old?.createdAt ?? new Date().toISOString(),
            generation: (old?.generation ?? -1) + 1,
            cursor: old?.cursor,
            checkedAt: old?.checkedAt,
          })
          await context.commit(
            (current) => {
              check(request.expectedRevision)
              return {
                ...current,
                sourceConnections: old
                  ? current.sourceConnections.map((c) => (c.id === old.id ? next : c))
                  : [...current.sourceConnections, next],
              }
            },
            { undoLabel: false },
          )
          check()
          return structuredClone(next)
        },
        async markChecked(request) {
          const owner = connection(request.connectionId, request.generation)
          await context.commit(
            (current) => {
              connection(owner.id, owner.generation)
              return {
                ...current,
                sourceConnections: current.sourceConnections.map((c) =>
                  c.id === owner.id ? { ...c, checkedAt: new Date().toISOString() } : c,
                ),
              }
            },
            { undoLabel: false, backgroundMetadata: true },
          )
          check()
        },
        async stage(request, signal) {
          const owner = connection(request.connectionId, request.generation)
          if (owner.mode !== 'import') throw new Error('只读索引不创建材料候选。')
          if (scans.has(owner.id)) throw new Error('该来源正在检查。')
          scans.add(owner.id)
          try {
            signal?.throwIfAborted()
            const raw = z
              .object({
                items: z.array(itemSchema).max(1000),
                deletedKeys: z.array(z.string().min(1).max(2048)).max(10000).optional(),
                complete: z.boolean(),
                cursor: z.string().max(16384).optional(),
              })
              .parse(request.snapshot)
            const seen = new Set(raw.items.map((i) => i.key)),
              deleted = new Set(raw.deletedKeys ?? [])
            if (seen.size !== raw.items.length || [...seen].some((k) => deleted.has(k)))
              throw new Error('来源返回重复或互相冲突的身份。')
            const originalSources = context.library.value.sources
            const bound = new Map(
              originalSources
                .filter((s) => s.binding?.connectionId === owner.id)
                .map((s) => [s.binding!.key, s]),
            )
            const existing = new Map(
              context.library.value.sourceCandidates
                .filter((c) => c.connectionId === owner.id)
                .map((c) => [c.key, c]),
            )
            const staged: SourceCandidate[] = [],
              uploads: MediaUpload[] = [],
              resolvedKeys = new Set<string>()
            let bytes = 0
            for (const item of raw.items) {
              connection(owner.id, owner.generation)
              signal?.throwIfAborted()
              const resources: { path: string; mediaId: string }[] = [],
                hashes: unknown[] = []
              for (const resource of item.resources ?? []) {
                if (!resource.blob.size || resource.blob.size > MAX_MEDIA_BYTES)
                  throw new Error('来源附件超过 10 MB。')
                if (resources.some((r) => r.path === resource.path))
                  throw new Error('来源附件路径重复。')
                const asset = mediaUpload(resource.blob, resource.path.split('/').at(-1)!)
                uploads.push(asset)
                resources.push({ path: resource.path, mediaId: asset.meta.id })
                hashes.push({
                  path: resource.path,
                  hash: await digest(resource.blob),
                  type: resource.blob.type,
                })
                bytes += asset.blob.size
                if (bytes > 128 * 1024 * 1024)
                  throw new Error('来源快照超过 128 MB，请缩小导入范围。')
              }
              const fingerprint = await digest(
                canonical({ ...item, original: undefined, resources: hashes }),
              )
              const source = bound.get(item.key),
                old = existing.get(item.key)
              if (source?.binding?.fingerprint === fingerprint && !source.binding.missing) {
                resolvedKeys.add(item.key)
                continue
              }
              if (old?.fingerprint === fingerprint) continue
              const prepared = prepareSource({
                title: item.title,
                content: item.text,
                url: item.url ?? '',
                format: item.format,
              })
              uploads.push(prepared.asset)
              bytes += prepared.asset.blob.size
              if (bytes > 128 * 1024 * 1024)
                throw new Error('来源快照超过 128 MB，请缩小导入范围。')
              staged.push(
                sourceCandidateSchema.parse({
                  id: crypto.randomUUID(),
                  connectionId: owner.id,
                  key: item.key,
                  fingerprint,
                  kind: source ? 'update' : 'add',
                  sourceId: source?.id,
                  baseMediaId: source?.mediaId,
                  title: item.title,
                  format: item.format,
                  url: item.url ?? '',
                  mediaId: prepared.asset.meta.id,
                  characters: prepared.source.characters,
                  path: item.path,
                  resources: resources.length ? resources : undefined,
                  links: item.links,
                  discoveredAt: new Date().toISOString(),
                }),
              )
            }
            if (raw.complete) for (const key of bound.keys()) if (!seen.has(key)) deleted.add(key)
            for (const key of deleted) {
              const source = bound.get(key)
              if (!source || source.binding?.missing) continue
              const fingerprint = await digest(`missing:${key}`)
              if (existing.get(key)?.fingerprint === fingerprint) continue
              staged.push(
                sourceCandidateSchema.parse({
                  id: crypto.randomUUID(),
                  connectionId: owner.id,
                  key,
                  fingerprint,
                  kind: 'missing',
                  sourceId: source.id,
                  baseMediaId: source.mediaId,
                  title: source.title,
                  format: source.format,
                  url: source.url,
                  discoveredAt: new Date().toISOString(),
                }),
              )
            }
            connection(owner.id, owner.generation)
            signal?.throwIfAborted()
            const used = new Set(
                staged
                  .flatMap((c) => [c.mediaId, ...(c.resources ?? []).map((r) => r.mediaId)])
                  .filter(Boolean),
              ),
              assets = uploads.filter((a) => used.has(a.meta.id))
            await context.commit(
              (current) => {
                connection(owner.id, owner.generation)
                signal?.throwIfAborted()
                // Editing while the network request runs must never silently rebase a candidate.
                for (const candidate of staged)
                  if (
                    candidate.sourceId &&
                    current.sources.find((s) => s.id === candidate.sourceId)?.mediaId !==
                      candidate.baseMediaId
                  )
                    throw new Error('检查期间本地材料已编辑，请重新检查来源。')
                for (const key of seen) {
                  const before = bound.get(key),
                    after = current.sources.find(
                      (s) => s.binding?.connectionId === owner.id && s.binding.key === key,
                    )
                  if (before?.id !== after?.id || before?.mediaId !== after?.mediaId)
                    throw new Error('检查期间来源关联已变化，请重新检查。')
                }
                const updates = new Set(staged.map((c) => c.key))
                return pruneMedia({
                  ...current,
                  media: [...current.media, ...assets.map((a) => a.meta)],
                  sourceConnections: current.sourceConnections.map((c) =>
                    c.id === owner.id
                      ? {
                          ...c,
                          cursor: raw.cursor ?? c.cursor,
                          checkedAt: new Date().toISOString(),
                        }
                      : c,
                  ),
                  sourceCandidates: [
                    ...current.sourceCandidates.filter(
                      (c) =>
                        c.connectionId !== owner.id ||
                        (!updates.has(c.key) &&
                          !resolvedKeys.has(c.key) &&
                          !(raw.complete && !seen.has(c.key) && c.kind !== 'missing')),
                    ),
                    ...staged,
                  ],
                })
              },
              { assets, undoLabel: false, backgroundMetadata: true },
            )
            check()
            return { candidates: staged.length }
          } finally {
            scans.delete(owner.id)
          }
        },
        async readCandidate(id) {
          check()
          const item = context.library.value.sourceCandidates.find((c) => c.id === id)
          if (!item) throw new Error('来源候选已变化。')
          const blob = item.mediaId ? await repository.getMedia(item.mediaId) : undefined
          check()
          if (item.mediaId && !blob) throw new Error('候选正文缺失。')
          return blob ? blob.text() : ''
        },
        async resolve(request) {
          check(request.expectedRevision)
          const candidate = context.library.value.sourceCandidates.find(
            (c) => c.id === request.candidateId && !c.dismissed,
          )
          if (!candidate) throw new Error('来源候选已变化，请重新查看。')
          const owner = context.library.value.sourceConnections.find(
            (c) => c.id === candidate.connectionId,
          )
          if (!owner) throw new Error('来源连接不存在。')
          let resultId: string | undefined
          await context.commit(
            (current) => {
              check(request.expectedRevision)
              const targetId = request.targetSourceId ?? candidate.sourceId,
                previous = targetId ? current.sources.find((s) => s.id === targetId) : undefined
              if (targetId && !previous) throw new Error('要关联的材料已不存在。')
              if (previous && request.expectedMediaId !== previous.mediaId)
                throw new Error('请确认当前本地版本后再处理来源更新。')
              if (request.targetSourceId && candidate.kind !== 'add')
                throw new Error('只有新发现的材料可以重新关联。')
              if (previous?.binding && previous.binding.connectionId !== owner.id)
                throw new Error('此材料已关联其他来源。')
              if (request.action === 'keep')
                return {
                  ...current,
                  sourceCandidates: current.sourceCandidates.map((c) =>
                    c.id === candidate.id ? { ...c, dismissed: true } : c,
                  ),
                }
              if (candidate.kind === 'missing') {
                if (!previous?.binding) throw new Error('来源关联已变化。')
                resultId = previous.id
                return {
                  ...current,
                  sources: current.sources.map((s) =>
                    s.id === previous.id
                      ? { ...s, binding: { ...previous.binding!, missing: true } }
                      : s,
                  ),
                  sourceCandidates: current.sourceCandidates.filter((c) => c.id !== candidate.id),
                }
              }
              if (!candidate.mediaId || !current.media.some((m) => m.id === candidate.mediaId))
                throw new Error('候选正文已不存在。')
              const timestamp = new Date().toISOString()
              const versions = previous
                ? [
                    ...(previous.versions ?? []),
                    {
                      title: previous.title,
                      url: previous.url,
                      format: previous.format,
                      mediaId: previous.mediaId,
                      characters: previous.characters,
                      acceptedAt: previous.acceptedAt ?? previous.createdAt,
                      reading: previous.reading,
                      document: previous.document,
                      inlineMedia: previous.inlineMedia,
                      properties: previous.properties,
                      derived: previous.derived,
                    },
                  ]
                : undefined
              const next = sourceSchema.parse({
                ...previous,
                id: previous?.id ?? crypto.randomUUID(),
                title: candidate.title,
                url: candidate.url,
                format: candidate.format,
                mediaId: candidate.mediaId,
                characters: candidate.characters,
                createdAt: previous?.createdAt ?? timestamp,
                acceptedAt: timestamp,
                versions,
                reading: undefined,
                inlineMedia: undefined,
                binding: {
                  connectionId: owner.id,
                  key: candidate.key,
                  fingerprint: candidate.fingerprint,
                  acceptedMediaId: candidate.mediaId,
                  links: candidate.links,
                },
                document: {
                  schemaVersion: 1,
                  providerId: owner.pluginId,
                  format: candidate.format,
                  originalMediaId: candidate.mediaId,
                  path: candidate.path,
                  resources: candidate.resources,
                },
                inbox:
                  previous?.inbox ??
                  (!previous
                    ? { state: 'new', kind: 'connector', capturedAt: timestamp, name: owner.title }
                    : undefined),
              })
              if (
                current.sources.some(
                  (s) =>
                    s.id !== next.id &&
                    s.binding &&
                    bindingKey(s.binding.connectionId, s.binding.key) ===
                      bindingKey(owner.id, candidate.key),
                )
              )
                throw new Error('该来源身份已关联另一份材料。')
              resultId = next.id
              return {
                ...current,
                sources: previous
                  ? current.sources.map((s) => (s.id === next.id ? next : s))
                  : [...current.sources, next],
                sourceCandidates: current.sourceCandidates.filter(
                  (c) => c.id !== candidate.id && !(c.sourceId && c.sourceId === next.id),
                ),
              }
            },
            {
              reason: '采用来源更新前',
              undoLabel: request.action === 'accept' ? '采用来源更新' : false,
            },
          )
          check()
          return { sourceId: resultId }
        },
      }
    },
  }
}
