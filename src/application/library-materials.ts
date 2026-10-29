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
import { sourceAtVersion, type Source } from '../core/source-data'
import {
  materialLocatorSchema,
  validateMaterialLocator,
  type MaterialReceipt,
} from '../core/material-data'
import { mediaSchema, noteSchema, saveNote, type Library, type MediaUpload } from '../core/model'

const MAX_FILES = 20
const MAX_ORIGINAL_BYTES = 32 * 1024 * 1024
const MAX_BATCH_BYTES = 64 * 1024 * 1024
const MAX_CANDIDATES = 100
const candidateSchema = z.strictObject({
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
function record(source: Source): MaterialRecord {
  return structuredClone({
    id: source.id,
    title: source.title,
    versionId: source.mediaId,
    format: source.format,
    document: source.document,
    parentSourceId: source.parentSourceId,
  })
}
function validateTree(candidates: readonly MaterialImportCandidate[]) {
  const keys = new Map(candidates.map((candidate) => [candidate.key, candidate]))
  if (keys.size !== candidates.length) throw new Error('导入材料的标识重复。')
  for (const candidate of candidates) {
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
type PlannedSource = {
  source: Source
  asset: MediaUpload
  original: MediaUpload
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
          )
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
            worker: typeof Worker !== 'undefined',
          }
        },
        snapshot() {
          assertCurrent()
          return {
            workspaceScope: plugin.scope,
            revision: context.revision,
            sources: context.library.value.sources.map(record),
            decks: context.library.value.decks.map(({ id, name }) => ({ id, name })),
          }
        },
        async list() {
          assertCurrent()
          return context.library.value.sources.map(record)
        },
        async get(sourceId, versionId) {
          const { snapshot, text } = await read(sourceId, versionId)
          return { material: record(snapshot), text }
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
                file.size > MAX_ORIGINAL_BYTES ||
                !importer.extensions.some((ext) => (file as File).name.toLowerCase().endsWith(ext)),
            ) ||
            request.files.reduce((sum, file) => sum + file.size, 0) > MAX_BATCH_BYTES
          )
            throw new Error('请选择受支持的文件；每批最多20个文件、64 MB，单文件最多32 MB。')
          const startRevision = context.revision
          const files = [...request.files]
          return plugin.runTask(
            { id: `import-${crypto.randomUUID()}`, title: importer.title, signal },
            async (task) => {
              const prepared: PlannedSource[] = []
              const fingerprints: unknown[] = []
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
                  .parse(await importer.parse(file, task))
                assertCurrent()
                task.signal.throwIfAborted()
                if (importerFor(importerId) !== importer) throw new Error('材料导入器已变化。')
                validateTree(candidates)
                if (!candidates.length || prepared.length + candidates.length > MAX_CANDIDATES)
                  throw new Error('每批应包含1至100份材料。')
                const original: MediaUpload = {
                  blob: new Blob([file], { type: file.type || 'application/octet-stream' }),
                  meta: mediaSchema.parse({
                    id: crypto.randomUUID(),
                    name: file.name,
                    size: file.size,
                    type: file.type || 'application/octet-stream',
                    createdAt: new Date().toISOString(),
                  }),
                }
                const group: PlannedSource[] = []
                for (const candidate of candidates) {
                  const snapshot = prepareSource({
                    title: candidate.title,
                    url: '',
                    format: candidate.format,
                    content: candidate.text,
                  })
                  const importKey = await digest(
                    canonical({
                      provider: plugin.pluginId,
                      importer: importerId,
                      fileHash,
                      candidate,
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
                  }
                  group.push({
                    ...snapshot,
                    original,
                    importKey,
                    key: `${fileIndex}:${candidate.key}`,
                    duplicateId,
                  })
                  if (!duplicateId) imported.set(importKey, snapshot.source.id)
                }
                candidates.forEach((candidate, index) => {
                  if (!candidate.parentKey) return
                  const parent =
                    group[candidates.findIndex((item) => item.key === candidate.parentKey)]!
                  group[index]!.source.parentSourceId = parent.duplicateId ?? parent.source.id
                })
                fingerprints.push({ fileHash, candidates })
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
