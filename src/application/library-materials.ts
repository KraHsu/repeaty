import { studyDay } from '../core/study-day'
import { studySettings } from '../core/study-settings'
import { z } from 'zod'
import type {
  MaterialHostApi,
  MaterialImporterContribution,
  MaterialImportCandidate,
  MaterialImportPlan,
  MaterialRecord,
  MaterialSelection,
  MaterialMutationContext,
} from '@repeaty/plugin-api'
import type { MaterialPluginIdentity } from '../plugins/materials'
import type { LibraryContext } from './library-context'
import { addSource, prepareSource, prepareSourceExcerpt, sourceExcerpt } from '../core/sources'
import { sourceAtVersion, sourceSchema, type Source } from '../core/source-data'
import {
  editSourceContent,
  upsertSourceAnnotation,
  removeSourceAnnotation,
} from '../core/source-workbench'
import { materialLocked } from '../core/material-sequence'
import { operationFor } from '../core/operations'
import { MAX_OPERATION_HISTORY, operationHistory } from '../core/operation-history'
import {
  materialLocatorSchema,
  validateMaterialLocator,
  type MaterialReceipt,
  materialPathSchema,
  materialMetadataSchema,
} from '../core/material-data'
import {
  MAX_MEDIA_BYTES,
  MAX_DOCUMENT_BYTES,
  mediaSchema,
  noteSchema,
  saveNote,
  type Library,
  type MediaUpload,
} from '../core/model'

const MAX_FILES = 20
const MAX_ORIGINAL_BYTES = MAX_DOCUMENT_BYTES
const MAX_BATCH_BYTES = 128 * 1024 * 1024
const MAX_CANDIDATES = 1000
export const candidateSchema = z.strictObject({
  key: z.string().min(1).max(200),
  title: z.string().trim().min(1).max(160),
  text: z.string().min(1).max(250_000),
  format: z.enum(['plain', 'markdown']),
  documentFormat: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
  readerId: z
    .string()
    .regex(/^[a-z][a-z0-9-]{0,63}$/)
    .optional(),
  parentKey: z.string().min(1).max(200).optional(),
  documentPath: materialPathSchema.optional(),
  documentData: materialMetadataSchema.optional(),
  container: z.boolean().optional(),
  url: z
    .string()
    .max(2048)
    .regex(/^https?:\/\/[^\s]+$/)
    .optional(),
  resources: z
    .array(z.strictObject({ path: materialPathSchema, blob: z.instanceof(Blob) }))
    .max(2000)
    .refine(
      (entries) => new Set(entries.map((entry) => entry.path)).size === entries.length,
      '文档资源路径重复。',
    )
    .optional(),
  studySequence: z
    .strictObject({
      groupKey: z.string().min(1).max(200),
      index: z.number().int().nonnegative().max(999),
      mode: z.enum(['free', 'sequential']),
    })
    .optional(),
})
const mutationSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  operationId: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-zA-Z0-9._-]+$/),
})
// Zod creates an owned DTO before the first await, including reactive Vue input and nested JSON.
const selectionSchema = z.object({
  locator: materialLocatorSchema,
  text: z.string().min(1).max(10_000),
  projection: z
    .object({ start: z.number().int().nonnegative(), end: z.number().int().positive() })
    .optional(),
})
const importCommitSchema = mutationSchema.extend({ planId: z.string().min(1) })
const selectionMutationSchema = mutationSchema.extend({
  sourceId: z.string().min(1),
  selection: selectionSchema,
})
const createNoteSchema = selectionMutationSchema.extend({
  note: z
    .object({ ...noteSchema.shape })
    .omit({ id: true, createdAt: true, updatedAt: true, excerpt: true, inlineMedia: true }),
})
const createExcerptSchema = selectionMutationSchema.extend({
  title: z.string().trim().min(1).max(160),
})
const editContentSchema = mutationSchema.extend({
  sourceId: z.string().min(1),
  versionId: z.string().min(1),
  content: z.string().min(1).max(250_000),
})
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(',')}}`
  return JSON.stringify(value)
}
async function digest(value: string | Blob): Promise<string> {
  const bytes =
    typeof value === 'string' ? new TextEncoder().encode(value) : await value.arrayBuffer()
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('')
}
function record(source: Source, sources: readonly Source[]): MaterialRecord {
  return structuredClone({
    id: source.id,
    title: source.title,
    versionId: source.mediaId,
    format: source.format,
    document: source.document,
    parentSourceId: source.parentSourceId,
    studySequence: source.studySequence,
    locked: materialLocked(source, sources),
  })
}
export function validateTree(candidates: readonly MaterialImportCandidate[]) {
  const keys = new Map(candidates.map((candidate) => [candidate.key, candidate]))
  if (keys.size !== candidates.length) throw new Error('导入材料的标识重复。')
  const groups = new Map<string, { mode: 'free' | 'sequential'; indices: Set<number> }>()
  for (const candidate of candidates) {
    const sequence = candidate.studySequence
    if (sequence) {
      const root = keys.get(sequence.groupKey),
        group = groups.get(sequence.groupKey)
      if (
        !root?.container ||
        root.studySequence ||
        candidate.parentKey !== sequence.groupKey ||
        (group && (group.mode !== sequence.mode || group.indices.has(sequence.index)))
      )
        throw new Error('章节分组、顺序或阅读模式不一致。')
      const entry = group ?? { mode: sequence.mode, indices: new Set<number>() }
      entry.indices.add(sequence.index)
      groups.set(sequence.groupKey, entry)
    }
    const visited = new Set<string>([candidate.key])
    let parent = candidate.parentKey
    while (parent) {
      if (!keys.has(parent) || visited.has(parent) || visited.size >= 32)
        throw new Error('导入材料的层级无效。')
      visited.add(parent)
      parent = keys.get(parent)!.parentKey
    }
  }
}
function originalType(file: File): string {
  const extension = file.name.toLowerCase().split('.').at(-1) ?? ''
  const inferred = (
    {
      pdf: 'application/pdf',
      epub: 'application/epub+zip',
      html: 'text/html',
      htm: 'text/html',
      xhtml: 'text/html',
    } as Record<string, string>
  )[extension]
  // Browser/OS file pickers frequently leave MIME empty or report ZIP/XHTML for these containers.
  return inferred ?? (file.type || 'application/octet-stream')
}
type PlannedSource = {
  source: Source
  asset: MediaUpload
  original: MediaUpload
  resources: MediaUpload[]
  key: string
  importKey: string
  duplicateId?: string
}
type ImportPlan = {
  public: MaterialImportPlan
  fingerprint: string
  sources: PlannedSource[]
  importer: MaterialImporterContribution
  expiresAt: number
}

/** Library-owned transaction facade. Views and plugins never acquire the repository write port. */
export function createMaterialCommands(context: LibraryContext) {
  const apis = new WeakMap<AbortSignal, MaterialHostApi>()
  return {
    materialApi(
      plugin: MaterialPluginIdentity,
      importerFor: (id: string) => MaterialImporterContribution | undefined,
    ): MaterialHostApi {
      const existing = apis.get(plugin.signal)
      if (existing) return existing
      const plans = new Map<string, ImportPlan>()
      const checkPlanCapacity = () => {
        for (const [id, plan] of plans) if (plan.expiresAt < Date.now()) plans.delete(id)
        if (plans.size >= 4) throw new Error('待确认的导入过多，请先确认或取消。')
      }
      let target: LibraryContext['repository'] | undefined
      const assertCurrent = () => {
        plugin.assertCurrent()
        plugin.signal.throwIfAborted()
        if (!context.ready.value || !plugin.scope || plugin.scope !== context.scope.value)
          throw new Error('学习库已变化，请重新操作。')
        target ??= context.repository
        if (target !== context.repository) throw new Error('学习库已变化，请重新操作。')
      }
      const revision = (expected: number) => {
        assertCurrent()
        if (context.revision !== expected) throw new Error('学习库内容已变化，请重新预览。')
      }
      const locate = (sourceId: string, versionId?: string) => {
        assertCurrent()
        const source = context.library.value.sources.find((entry) => entry.id === sourceId)
        const snapshot = source && sourceAtVersion(source, versionId)
        if (!snapshot) throw new Error('材料版本已不存在。')
        return snapshot
      }
      const read = async (sourceId: string, versionId?: string) => {
        const snapshot = locate(sourceId, versionId)
        const text = await context.getSource(sourceId, plugin.signal, snapshot.mediaId)
        assertCurrent()
        // The returned text and descriptor address exactly the captured immutable version.
        locate(sourceId, snapshot.mediaId)
        return { snapshot, text }
      }
      const receiptId = (operationId: string) => digest(`${plugin.pluginId}\0${operationId}`)
      function prior(id: string, fingerprint: string, kind: MaterialReceipt['kind']) {
        assertCurrent()
        const receipt = context.library.value.materialReceipts.find((item) => item.id === id)
        if (!receipt) return undefined
        if (
          receipt.pluginId !== plugin.pluginId ||
          receipt.fingerprint !== fingerprint ||
          receipt.kind !== kind
        )
          throw new Error('操作标识已用于不同的内容。')
        if (
          receipt.result.sourceIds.some(
            (id) => !context.library.value.sources.some((source) => source.id === id),
          ) ||
          receipt.result.noteIds.some(
            (id) => !context.library.value.notes.some((note) => note.id === id),
          ) ||
          (receipt.result.versionId &&
            !receipt.result.sourceIds.some((id) => {
              const source = context.library.value.sources.find((item) => item.id === id)
              return source && sourceAtVersion(source, receipt.result.versionId)
            }))
        )
          throw new Error('此操作已保存，但其结果已撤销或删除；请使用新的操作标识。')
        return receipt
      }
      function withReceipt(
        current: Library,
        id: string,
        request: MaterialMutationContext,
        fingerprint: string,
        kind: MaterialReceipt['kind'],
        result: MaterialReceipt['result'],
      ): Library {
        if (current.materialReceipts.length >= 100_000) throw new Error('材料操作记录已达上限。')
        return {
          ...current,
          materialReceipts: [
            ...current.materialReceipts,
            {
              id,
              pluginId: plugin.pluginId,
              operationId: request.operationId,
              fingerprint,
              kind,
              result,
              createdAt: new Date().toISOString(),
            },
          ],
        }
      }
      async function selection(sourceId: string, input: MaterialSelection) {
        const data = await read(sourceId, input.locator.versionId)
        const locator = validateMaterialLocator(data.snapshot, input.locator)
        const range = locator.kind === 'text' ? locator : input.projection
        if (!range) throw new Error('此选区缺少文本投影位置。')
        const excerpt = sourceExcerpt(data.snapshot, data.text, range.start, range.end)
        if (
          excerpt.quote !== input.text ||
          (locator.kind === 'text' && locator.quote !== excerpt.quote)
        )
          throw new Error('摘录与原文不一致，请重新选取。')
        return { ...data, excerpt: { ...excerpt, locator } }
      }
      const clear = () => plans.clear()
      plugin.signal.addEventListener('abort', clear, { once: true })
      const api: MaterialHostApi = {
        capabilities() {
          const available =
            context.ready.value &&
            plugin.scope === context.scope.value &&
            !plugin.signal.aborted &&
            (!target || target === context.repository)
          return {
            protocolVersion: 1,
            workspaceScope: plugin.scope,
            available,
            import: available,
            createNote: available,
            search: available,
            worker: plugin.worker === true,
          }
        },
        snapshot() {
          assertCurrent()
          return {
            workspaceScope: plugin.scope,
            revision: context.revision,
            sources: context.library.value.sources.map((source) =>
              record(source, context.library.value.sources),
            ),
            decks: context.library.value.decks.map(({ id, name }) => ({ id, name })),
          }
        },
        async list() {
          assertCurrent()
          return context.library.value.sources.map((source) =>
            record(source, context.library.value.sources),
          )
        },
        async get(sourceId, versionId) {
          const { snapshot, text } = await read(sourceId, versionId)
          return { material: record(snapshot, context.library.value.sources), text }
        },
        async original(sourceId, versionId) {
          const snapshot = locate(sourceId, versionId)
          if (!snapshot.document) return undefined
          const blob = await context.repository.getMedia(snapshot.document.originalMediaId)
          assertCurrent()
          locate(sourceId, snapshot.mediaId)
          if (!blob) throw new Error('原始文件缺失，请从备份恢复。')
          return blob
        },
        async resource(sourceId, path, versionId) {
          materialPathSchema.parse(path)
          const snapshot = locate(sourceId, versionId)
          const ref = snapshot.document?.resources?.find((entry) => entry.path === path)
          if (!ref) return undefined
          const blob = await context.repository.getMedia(ref.mediaId)
          assertCurrent()
          locate(sourceId, snapshot.mediaId)
          if (!blob) throw new Error('文档资源缺失，请从备份恢复。')
          return blob
        },
        async setSequence(input) {
          const request = mutationSchema
            .extend({
              sourceId: z.string().min(1),
              mode: z.enum(['free', 'sequential']).optional(),
              completed: z.boolean().optional(),
            })
            .parse(input)
          const fingerprint = await digest(
            canonical({ ...request, expectedRevision: undefined, operationId: undefined }),
          )
          const id = await receiptId(request.operationId)
          if (prior(id, fingerprint, 'set-sequence')) return { revision: context.revision }
          revision(request.expectedRevision)
          await context.commit(
            (current) => {
              revision(request.expectedRevision)
              const source = locate(request.sourceId)
              const groupId =
                source.studySequence?.groupId ??
                (source.document?.container ? source.id : undefined)
              if (
                !groupId ||
                (request.completed !== undefined && !source.studySequence) ||
                (request.mode === undefined && request.completed === undefined)
              )
                throw new Error('此材料没有章节阅读安排。')
              if (request.completed === true && materialLocked(source, current.sources))
                throw new Error('请先完成前面的章节。')
              const sources = current.sources.map((entry) =>
                entry.studySequence?.groupId === groupId
                  ? {
                      ...entry,
                      studySequence: {
                        ...entry.studySequence,
                        mode: request.mode ?? entry.studySequence.mode,
                        completed:
                          entry.id === source.id
                            ? (request.completed ?? entry.studySequence.completed)
                            : entry.studySequence.completed,
                      },
                    }
                  : entry,
              )
              return withReceipt(
                {
                  ...current,
                  sources,
                  studyEvents:
                    request.completed === true && !source.studySequence?.completed
                      ? [
                          ...current.studyEvents,
                          {
                            id: crypto.randomUUID(),
                            kind: 'reading' as const,
                            sourceId: source.id,
                            occurredAt: new Date().toISOString(),
                            studyDay: studyDay(new Date(), studySettings(current)),
                          },
                        ]
                      : current.studyEvents,
                },
                id,
                request,
                fingerprint,
                'set-sequence',
                { sourceIds: [source.id], noteIds: [] },
              )
            },
            { undoLabel: '调整章节阅读安排' },
          )
          assertCurrent()
          return { revision: context.revision }
        },
        async annotate(input) {
          const request = selectionMutationSchema
            .extend({ body: z.string().trim().min(1).max(10_000), id: z.uuid().optional() })
            .parse(input)
          const fingerprint = await digest(
            canonical({ ...request, expectedRevision: undefined, operationId: undefined }),
          )
          const receipt = await receiptId(request.operationId)
          const completed = prior(receipt, fingerprint, 'annotate')
          if (completed) return { id: completed.result.annotationId!, revision: context.revision }
          revision(request.expectedRevision)
          const selected = await selection(request.sourceId, request.selection)
          let annotationId = ''
          await context.commit(
            (current) => {
              revision(request.expectedRevision)
              const next = upsertSourceAnnotation(
                current,
                {
                  ...selected.excerpt,
                  mediaId: selected.snapshot.mediaId,
                  scope: plugin.scope,
                  id: request.id,
                  body: request.body,
                },
                selected.text,
              )
              annotationId =
                request.id ??
                next.sources.find((entry) => entry.id === request.sourceId)!.annotations!.at(-1)!.id
              return withReceipt(next, receipt, request, fingerprint, 'annotate', {
                sourceIds: [request.sourceId],
                noteIds: [],
                annotationId,
              })
            },
            { undoLabel: '保存材料批注' },
          )
          assertCurrent()
          return { id: annotationId, revision: context.revision }
        },
        async removeAnnotation(input) {
          const request = mutationSchema
            .extend({ sourceId: z.string().min(1), id: z.uuid() })
            .parse(input)
          const fingerprint = await digest(
            canonical({ sourceId: request.sourceId, id: request.id }),
          )
          const receipt = await receiptId(request.operationId)
          if (prior(receipt, fingerprint, 'remove-annotation'))
            return { revision: context.revision }
          revision(request.expectedRevision)
          await context.commit(
            (current) => {
              revision(request.expectedRevision)
              return withReceipt(
                removeSourceAnnotation(current, request.sourceId, request.id),
                receipt,
                request,
                fingerprint,
                'remove-annotation',
                { sourceIds: [request.sourceId], noteIds: [] },
              )
            },
            { undoLabel: '删除材料批注' },
          )
          assertCurrent()
          return { revision: context.revision }
        },
        async prepareImport(request, signal) {
          assertCurrent()
          signal?.throwIfAborted()
          const importerId = request.importerId
          checkPlanCapacity()
          const importer = importerFor(importerId)
          if (!importer) throw new Error('材料导入器已不可用。')
          if (
            !Array.isArray(request.files) ||
            !request.files.length ||
            request.files.length > MAX_FILES ||
            request.files.some(
              (file) =>
                !(file instanceof Blob) ||
                !('name' in file) ||
                typeof file.name !== 'string' ||
                !file.size ||
                file.size > MAX_ORIGINAL_BYTES ||
                !importer.extensions.some((ext) => (file as File).name.toLowerCase().endsWith(ext)),
            ) ||
            request.files.reduce((sum, file) => sum + file.size, 0) > MAX_BATCH_BYTES
          )
            throw new Error('请选择非空的受支持文件；每批最多20个文件、128 MB，原件最多64 MB。')
          const relatedFiles = [...(request.relatedFiles ?? [])]
          if (
            relatedFiles.length > 2000 ||
            relatedFiles.some(
              (file) =>
                !(file instanceof File) ||
                !file.size ||
                file.size > MAX_MEDIA_BYTES ||
                !materialPathSchema.safeParse(file.webkitRelativePath || file.name).success,
            ) ||
            [...request.files, ...relatedFiles].reduce((sum, file) => sum + file.size, 0) >
              MAX_BATCH_BYTES
          )
            throw new Error('关联文件路径或大小无效；每批总大小不得超过128 MB。')
          const startRevision = context.revision
          const files = [...request.files]
          return plugin.runTask(
            { id: `import-${crypto.randomUUID()}`, title: importer.title, signal },
            async (task) => {
              const prepared: PlannedSource[] = []
              const fingerprints: unknown[] = []
              const resourceAssets = new Map<string, MediaUpload>()
              const resourceDigests = new WeakMap<Blob, Promise<string>>()
              let preparedBytes = files.reduce((sum, file) => sum + file.size, 0)
              const imported = new Map(
                context.library.value.sources.flatMap((source) =>
                  source.document?.importKey
                    ? [[source.document.importKey, source.id] as const]
                    : [],
                ),
              )
              for (let fileIndex = 0; fileIndex < files.length; fileIndex++) {
                assertCurrent()
                task.signal.throwIfAborted()
                const file = files[fileIndex]!
                const fileHash = await digest(file)
                const candidates = z
                  .array(candidateSchema)
                  .max(MAX_CANDIDATES)
                  .parse(await importer.parse(file, { ...task, files: relatedFiles }))
                assertCurrent()
                task.signal.throwIfAborted()
                if (importerFor(importerId) !== importer) throw new Error('材料导入器已变化。')
                validateTree(candidates)
                if (!candidates.length || prepared.length + candidates.length > MAX_CANDIDATES)
                  throw new Error('每批应包含1至1000份材料。')
                const original: MediaUpload = {
                  blob: new Blob([file], { type: originalType(file) }),
                  meta: mediaSchema.parse({
                    id: crypto.randomUUID(),
                    name: file.name,
                    size: file.size,
                    type: originalType(file),
                    createdAt: new Date().toISOString(),
                  }),
                }
                const group: PlannedSource[] = []
                for (const candidate of candidates) {
                  const resources: MediaUpload[] = []
                  const resourceRefs: { path: string; mediaId: string }[] = []
                  const resourceHashes: { path: string; hash: string; type: string }[] = []
                  for (const resource of candidate.resources ?? []) {
                    if (!resource.blob.size || resource.blob.size > MAX_MEDIA_BYTES)
                      throw new Error('文档关联资源不能超过10 MB。')
                    let hashing = resourceDigests.get(resource.blob)
                    if (!hashing) {
                      hashing = digest(resource.blob)
                      resourceDigests.set(resource.blob, hashing)
                    }
                    const hash = await hashing
                    const key = `${resource.blob.type}:${hash}`
                    let asset = resourceAssets.get(key)
                    if (!asset) {
                      preparedBytes += resource.blob.size
                      if (preparedBytes > MAX_BATCH_BYTES)
                        throw new Error('文档原件与关联资源每批总大小不能超过128 MB。')
                      asset = {
                        blob: resource.blob,
                        meta: mediaSchema.parse({
                          id: crypto.randomUUID(),
                          name: resource.path.split('/').at(-1),
                          size: resource.blob.size,
                          type: resource.blob.type,
                          createdAt: new Date().toISOString(),
                        }),
                      }
                      resourceAssets.set(key, asset)
                    }
                    resources.push(asset)
                    resourceRefs.push({ path: resource.path, mediaId: asset.meta.id })
                    resourceHashes.push({ path: resource.path, hash, type: resource.blob.type })
                    await task.yield()
                  }
                  const snapshot = prepareSource({
                    title: candidate.title,
                    url: candidate.url ?? '',
                    format: candidate.format,
                    content: candidate.text,
                  })
                  const importKey = await digest(
                    canonical({
                      provider: plugin.pluginId,
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
                  const duplicateId = imported.get(importKey)
                  snapshot.source.document = {
                    schemaVersion: 1,
                    providerId: plugin.pluginId,
                    readerId: candidate.readerId,
                    format: candidate.documentFormat,
                    originalMediaId: original.meta.id,
                    importKey,
                    path: candidate.documentPath,
                    data: candidate.documentData,
                    container: candidate.container,
                    resources: resourceRefs.length ? resourceRefs : undefined,
                  }
                  group.push({
                    ...snapshot,
                    original,
                    importKey,
                    key: `${fileIndex}:${candidate.key}`,
                    duplicateId,
                    resources,
                  })
                  if (!duplicateId) imported.set(importKey, snapshot.source.id)
                }
                candidates.forEach((candidate, index) => {
                  if (candidate.studySequence) {
                    const root =
                      group[
                        candidates.findIndex(
                          (item) => item.key === candidate.studySequence!.groupKey,
                        )
                      ]
                    if (
                      !root ||
                      !root.source.document?.container ||
                      candidate.parentKey !== candidate.studySequence.groupKey
                    )
                      throw new Error('章节必须属于同批导入的书籍。')
                    group[index]!.source.studySequence = {
                      groupId: root.duplicateId ?? root.source.id,
                      index: candidate.studySequence.index,
                      mode: candidate.studySequence.mode,
                      completed: false,
                    }
                  }
                  if (!candidate.parentKey) return
                  const parent =
                    group[candidates.findIndex((item) => item.key === candidate.parentKey)]!
                  group[index]!.source.parentSourceId = parent.duplicateId ?? parent.source.id
                })
                fingerprints.push({ fileHash, candidates: group.map((entry) => entry.importKey) })
                prepared.push(...group)
                task.progress({ completed: fileIndex + 1, total: files.length })
                await task.yield()
              }
              revision(startRevision)
              task.signal.throwIfAborted()
              const id = crypto.randomUUID()
              const visible: MaterialImportPlan = {
                id,
                revision: startRevision,
                candidates: prepared.map((item) => ({
                  key: item.key,
                  title: item.source.title,
                  duplicate: !!item.duplicateId,
                })),
              }
              const fingerprint = await digest(
                canonical({ importer: importerId, files: fingerprints }),
              )
              revision(startRevision)
              task.signal.throwIfAborted()
              // Other preparations may have finished while this parser or digest was pending.
              checkPlanCapacity()
              plans.set(id, {
                public: visible,
                fingerprint,
                sources: prepared,
                importer,
                expiresAt: Date.now() + 15 * 60_000,
              })
              return structuredClone(visible)
            },
          )
        },
        discardImport(id) {
          plans.delete(id)
        },
        async commitImport(request) {
          request = importCommitSchema.parse(request)
          assertCurrent()
          const plan = plans.get(request.planId)
          if (!plan || plan.expiresAt < Date.now())
            throw new Error('导入预览已过期，请重新选择文件。')
          if (importerFor(plan.importer.id) !== plan.importer)
            throw new Error('材料导入器已变化，请重新预览。')
          const id = await receiptId(request.operationId)
          const completed = prior(id, plan.fingerprint, 'import')
          if (completed)
            return { sourceIds: [...completed.result.sourceIds], revision: context.revision }
          revision(request.expectedRevision)
          if (request.expectedRevision !== plan.public.revision)
            throw new Error('导入预览已过期，请重新选择文件。')
          const additions = plan.sources.filter((item) => !item.duplicateId)
          const uploads = new Map<string, MediaUpload>()
          for (const item of additions) {
            uploads.set(item.asset.meta.id, item.asset)
            uploads.set(item.original.meta.id, item.original)
            for (const resource of item.resources) uploads.set(resource.meta.id, resource)
          }
          const sourceIds = plan.sources.map((item) => item.duplicateId ?? item.source.id)
          await context.commit(
            (current) => {
              revision(request.expectedRevision)
              let next = {
                ...current,
                media: [...current.media, ...[...uploads.values()].map((asset) => asset.meta)],
              }
              for (const item of additions)
                next = { ...next, sources: [...next.sources, item.source] }
              return withReceipt(next, id, request, plan.fingerprint, 'import', {
                sourceIds,
                noteIds: [],
              })
            },
            {
              assets: [...uploads.values()],
              reason: '导入材料前',
              undoLabel: additions.length ? '导入材料' : false,
            },
          )
          assertCurrent()
          return { sourceIds, revision: context.revision }
        },
        async createNote(request) {
          const owned = createNoteSchema.parse(request)
          request = owned
          assertCurrent()
          const fingerprint = await digest(
            canonical({
              sourceId: request.sourceId,
              selection: request.selection,
              note: request.note,
            }),
          )
          const id = await receiptId(request.operationId)
          const completed = prior(id, fingerprint, 'create-note')
          if (completed) return { noteId: completed.result.noteIds[0]!, revision: context.revision }
          revision(request.expectedRevision)
          const selected = await selection(request.sourceId, request.selection)
          let noteId = ''
          await context.commit(
            (current) => {
              revision(request.expectedRevision)
              locate(selected.snapshot.id, selected.snapshot.mediaId)
              const next = saveNote(current, {
                ...owned.note,
                excerpt: selected.excerpt,
              })
              noteId = next.notes.at(-1)!.id
              return withReceipt(next, id, request, fingerprint, 'create-note', {
                sourceIds: [],
                noteIds: [noteId],
              })
            },
            { undoLabel: '添加卡片' },
          )
          assertCurrent()
          return { noteId, revision: context.revision }
        },
        async createExcerpt(request) {
          request = createExcerptSchema.parse(request)
          assertCurrent()
          const fingerprint = await digest(
            canonical({
              sourceId: request.sourceId,
              selection: request.selection,
              title: request.title,
            }),
          )
          const id = await receiptId(request.operationId)
          const completed = prior(id, fingerprint, 'create-excerpt')
          if (completed)
            return { sourceId: completed.result.sourceIds[0]!, revision: context.revision }
          revision(request.expectedRevision)
          const selected = await selection(request.sourceId, request.selection)
          const prepared = prepareSourceExcerpt(
            selected.snapshot,
            selected.text,
            selected.excerpt,
            request.title,
          )
          await context.commit(
            (current) => {
              revision(request.expectedRevision)
              locate(selected.snapshot.id, selected.snapshot.mediaId)
              return withReceipt(
                addSource(current, prepared.source, prepared.asset),
                id,
                request,
                fingerprint,
                'create-excerpt',
                { sourceIds: [prepared.source.id], noteIds: [] },
              )
            },
            { assets: [prepared.asset], undoLabel: '保存摘录' },
          )
          assertCurrent()
          return { sourceId: prepared.source.id, revision: context.revision }
        },
        async editContent(request) {
          request = editContentSchema.parse(request)
          assertCurrent()
          const fingerprint = await digest(
            canonical({
              sourceId: request.sourceId,
              versionId: request.versionId,
              content: request.content,
            }),
          )
          const id = await receiptId(request.operationId)
          const completed = prior(id, fingerprint, 'edit-content')
          if (completed)
            return {
              sourceId: completed.result.sourceIds[0]!,
              versionId: completed.result.versionId!,
              revision: context.revision,
            }
          revision(request.expectedRevision)
          let before = context.library.value
          const source = locate(request.sourceId)
          if (source.mediaId !== request.versionId) throw new Error('材料版本已变化，请重新预览。')
          if (source.properties === undefined && 'readSourceProperties' in context.repository) {
            const properties = await context.repository.readSourceProperties(source.id)
            revision(request.expectedRevision)
            // Capture unmanaged YAML in the undo baseline without an intermediate write.
            before = {
              ...context.library.value,
              sources: context.library.value.sources.map((item) =>
                item.id === source.id ? sourceSchema.parse({ ...item, properties }) : item,
              ),
            }
          }
          const prepared = editSourceContent(before, {
            scope: plugin.scope,
            sourceId: request.sourceId,
            mediaId: request.versionId,
            content: request.content,
          })
          const next = withReceipt(prepared.library, id, request, fingerprint, 'edit-content', {
            sourceIds: [prepared.source.id],
            noteIds: [],
            versionId: prepared.source.mediaId,
          })
          const entry = operationFor(before, next, plugin.scope, '编辑材料正文')!
          await context.commit(
            (current) => {
              revision(request.expectedRevision)
              const source = current.sources.find((item) => item.id === request.sourceId)
              if (source?.mediaId !== request.versionId)
                throw new Error('材料版本已变化，请重新预览。')
              return next
            },
            {
              assets: [prepared.asset],
              reason: '编辑材料正文前',
              undoLabel: false,
              operationHistory: operationHistory([
                ...context.operations.value.slice(-(MAX_OPERATION_HISTORY - 1)),
                entry,
              ]),
            },
          )
          assertCurrent()
          return {
            sourceId: prepared.source.id,
            versionId: prepared.source.mediaId,
            revision: context.revision,
          }
        },
        async search(query, signal) {
          assertCurrent()
          if (
            !Number.isInteger(query.limit) ||
            query.limit < 1 ||
            query.limit > 100 ||
            query.text.length > 200
          )
            throw new Error('材料检索请求无效。')
          // The baseline host queries metadata; richer rebuildable indexes are provider contributions.
          const startRevision = context.revision
          const offset = query.cursor ? Number(query.cursor.split(':')[1]) : 0
          if (
            query.cursor &&
            (query.cursor.split(':')[0] !== String(startRevision) ||
              !Number.isInteger(offset) ||
              offset < 0)
          )
            throw new Error('搜索结果已变化，请重新搜索。')
          const normalized = query.text.trim().toLocaleLowerCase()
          const matches = context.library.value.sources.filter((source) =>
            source.title.toLocaleLowerCase().includes(normalized),
          )
          signal?.throwIfAborted()
          return {
            hits: matches.slice(offset, offset + query.limit).map((source) => ({
              sourceId: source.id,
              versionId: source.mediaId,
              title: source.title,
              snippet: '',
            })),
            nextCursor:
              offset + query.limit < matches.length
                ? `${startRevision}:${offset + query.limit}`
                : undefined,
          }
        },
      }
      apis.set(plugin.signal, api)
      return api
    },
  }
}
