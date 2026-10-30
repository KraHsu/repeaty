import type {
  CollectionHostApi,
  CollectionImportPlan,
  MaterialImportCandidate,
} from '@repeaty/plugin-api'
import { z } from 'zod'
import type { LibraryContext } from './library-context'
import {
  canonical,
  digest,
  prepareCollectionFile,
  type PreparedCollectionSource,
} from './collection-preparation'
import { inspectCollectionPath } from '../core/collection-input'
import { sourceDetailsSchema, sourceSchema } from '../core/source-data'
import type { Library, MediaUpload } from '../core/model'

export interface CollectionParser {
  pluginId: string
  id: string
  title: string
  extensions: readonly string[]
  current(): boolean
  parse(
    file: File,
    files: readonly File[],
    signal: AbortSignal,
  ): Promise<readonly MaterialImportCandidate[]>
}
type Plan = {
  visible: CollectionImportPlan
  staged: PreparedCollectionSource[]
  checks: (() => boolean)[]
  expires: number
  fingerprint: string
}
const mutation = z.object({
  expectedRevision: z.number().int().nonnegative(),
  operationId: z.string().regex(/^[a-zA-Z0-9._-]{1,100}$/),
})

export function createCollectionCommands(context: LibraryContext) {
  return {
    collectionApi(parsers: () => readonly CollectionParser[]): CollectionHostApi {
      const scope = context.scope.value,
        repository = context.repository
      const plans = new Map<string, Plan>()
      function check(expected?: number) {
        if (
          !context.ready.value ||
          context.scope.value !== scope ||
          context.repository !== repository
        )
          throw new Error('学习库已变化，请重新收集。')
        if (expected !== undefined && context.revision !== expected)
          throw new Error('学习库已变化，请重新预览。')
      }
      function receipt(current: Library, id: string, fingerprint: string) {
        const saved = current.materialReceipts.find((value) => value.id === id)
        if (saved && saved.fingerprint !== fingerprint) throw new Error('操作标识已用于其他内容。')
        if (
          saved &&
          saved.result.sourceIds.some((id) => !current.sources.some((source) => source.id === id))
        )
          throw new Error('收集结果已撤销或删除，请重新预览。')
        return saved
      }
      return {
        importers() {
          check()
          return parsers().map(({ pluginId, id, title, extensions }) => ({
            pluginId,
            id,
            title,
            extensions: [...extensions],
          }))
        },
        snapshot() {
          check()
          return { revision: context.revision, workspaceScope: scope }
        },
        discardCollection(id) {
          plans.delete(id)
        },
        async prepareCollection(request, signal) {
          request = {
            ...request,
            text: request.text ? { ...request.text } : undefined,
            importers: request.importers ? { ...request.importers } : undefined,
          }
          check()
          signal?.throwIfAborted()
          const startRevision = context.revision
          const controller = signal ?? new AbortController().signal
          const files = [...(request.files ?? [])]
          if (
            files.length > 2000 ||
            files.some((f) => !(f instanceof File)) ||
            files.reduce((n, f) => n + f.size, 0) > 128 * 1024 * 1024
          )
            throw new Error('每批最多 2000 个文件，总大小不能超过 128 MB。')
          const destination = z.enum(['inbox', 'library']).parse(request.destination)
          const kind = z.enum(['file', 'clipboard', 'global']).optional().parse(request.kind)
          const skipped: { name: string; reason: string }[] = [],
            staged: PreparedCollectionSource[] = [],
            checks: (() => boolean)[] = []
          const entries = parsers()
          if (request.text) {
            const text = z
              .object({
                text: z
                  .string()
                  .min(1)
                  .max(250000)
                  .refine((value) => !!value.trim()),
                title: z.string().trim().max(160).optional(),
                url: sourceDetailsSchema.shape.url.optional(),
                format: z.enum(['plain', 'markdown']).optional(),
              })
              .parse(request.text)
            const firstLine = text.text
              .split(/\r?\n/)
              .find((line) => line.trim())
              ?.trim()
              .slice(0, 60)
            const name = `${text.title || firstLine || '收集的文字'}.${text.format === 'plain' ? 'txt' : 'md'}`
            request.text = {
              ...text,
              url: text.url || undefined,
              title: text.title || firstLine || '收集的文字',
            }
            const safeName = name.replace(/[<>:\x22/\\|?*\u0000-\u001f]/g, '_')
            const file = new File(
              [text.text],
              'reason' in inspectCollectionPath(safeName) ||
                /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(safeName)
                ? `_${safeName}`
                : safeName,
              {
                type: text.format === 'plain' ? 'text/plain' : 'text/markdown',
              },
            )
            files.unshift(file)
          }
          const accepted = new Set<string>()
          for (const [index, file] of files.entries()) {
            check(startRevision)
            controller.throwIfAborted()
            const path = file.webkitRelativePath || file.name,
              inspection = inspectCollectionPath(path)
            if ('reason' in inspection || !file.size || file.size > 64 * 1024 * 1024) {
              skipped.push({ name: path, reason: '文件为空、路径不受支持或超过大小限制' })
              continue
            }
            if (accepted.has(path)) {
              skipped.push({ name: path, reason: '重复路径' })
              continue
            }
            accepted.add(path)
            const builtIn = /\.(md|markdown|txt)$/i.test(file.name)
            const matches = builtIn
              ? []
              : entries.filter((entry) =>
                  entry.extensions.some((ext) =>
                    file.name.toLowerCase().endsWith(ext.toLowerCase()),
                  ),
                )
            const choice = request.importers?.[path]
            const parser = choice
              ? matches.find((entry) => `${entry.pluginId}:${entry.id}` === choice)
              : matches.length === 1
                ? matches[0]
                : undefined
            if (!builtIn && choice && !parser)
              throw new Error(`${file.name}：所选导入器已不可用，请重新选择导入方式。`)
            if (!builtIn && !choice && matches.length > 1)
              throw new Error(`${file.name}：此格式有多种导入方式，请先选择。`)
            let candidates: readonly MaterialImportCandidate[],
              provider = 'repeaty-collection'
            if (builtIn) {
              if (file.size > 1024 * 1024) throw new Error(`${file.name}：文本文件不能超过 1 MB。`)
              const bytes = await file.arrayBuffer()
              let text: string
              try {
                text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
              } catch {
                throw new Error('无法读取文件，请使用 UTF-8 编码。')
              }
              const format = /\.(md|markdown)$/i.test(file.name) ? 'markdown' : 'plain'
              candidates = [
                {
                  key: 'text',
                  title:
                    index === 0 && request.text?.title
                      ? request.text.title
                      : file.name.replace(/\.[^.]+$/, ''),
                  text,
                  format,
                  documentFormat: format,
                  documentPath: path,
                  url: index === 0 && request.text ? request.text.url : undefined,
                },
              ]
            } else if (parser) {
              if (!parser.current()) throw new Error('导入器已变化，请重新预览。')
              provider = parser.pluginId
              checks.push(parser.current)
              candidates = await parser.parse(file, files, controller)
              if (!parser.current()) throw new Error('导入器已变化，请重新预览。')
            } else {
              skipped.push({ name: path, reason: '没有启用支持此格式的阅读器插件' })
              continue
            }
            const prepared = await prepareCollectionFile(file, candidates, provider, controller)
            for (const item of prepared) {
              item.key = `${index}:${item.key}`
              if (destination === 'inbox')
                item.source.inbox = {
                  state: 'new',
                  capturedAt: new Date().toISOString(),
                  kind: kind ?? (request.text && index === 0 ? 'text' : 'file'),
                  name: path,
                }
            }
            staged.push(...prepared)
            if (staged.length > 1000) throw new Error('每批最多 1000 份材料，请分批导入。')
            const assets = new Map(staged.flatMap((s) => s.assets).map((a) => [a.meta.id, a]))
            if ([...assets.values()].reduce((sum, a) => sum + a.blob.size, 0) > 256 * 1024 * 1024)
              throw new Error('导入后的正文和附件超过 256 MB，请分批导入。')
          }
          check(startRevision)
          controller.throwIfAborted()
          if (!staged.length) throw new Error(skipped[0]?.reason ?? '请先添加文件或文字。')
          const known = new Set(
            context.library.value.sources.flatMap((s) =>
              s.document?.importKey ? [s.document.importKey] : [],
            ),
          )
          const visible: CollectionImportPlan = {
            id: crypto.randomUUID(),
            revision: startRevision,
            skipped,
            candidates: staged.map((item) => {
              const duplicate = known.has(item.fingerprint)
              known.add(item.fingerprint)
              return {
                key: item.key,
                title: item.source.title,
                duplicate,
                format: item.source.document?.format ?? item.source.format,
                sourceName: item.sourceName,
              }
            }),
          }
          const fingerprint = await digest(
            canonical({ destination, kind, items: staged.map((s) => s.fingerprint) }),
          )
          check(startRevision)
          controller.throwIfAborted()
          for (const [id, plan] of plans) if (plan.expires < Date.now()) plans.delete(id)
          if (plans.size >= 4) throw new Error('请先确认或取消其他收集预览。')
          plans.set(visible.id, {
            visible,
            staged,
            checks,
            expires: Date.now() + 15 * 60_000,
            fingerprint,
          })
          return structuredClone(visible)
        },
        async commitCollection(input) {
          const request = mutation
            .extend({ planId: z.string(), selection: z.array(z.string()).max(1000).optional() })
            .parse(input)
          check()
          const plan = plans.get(request.planId)
          if (!plan || plan.expires < Date.now()) throw new Error('收集预览已过期，请重新选择。')
          const selected = new Set(request.selection ?? plan.staged.map((s) => s.key))
          if (!selected.size || [...selected].some((k) => !plan.staged.some((s) => s.key === k)))
            throw new Error('请选择有效的收集项目。')
          const fingerprint = await digest(
              canonical({ plan: plan.fingerprint, selected: [...selected].sort() }),
            ),
            id = await digest(`collection:${request.operationId}`)
          check()
          const prior = receipt(context.library.value, id, fingerprint)
          if (prior) return { sourceIds: prior.result.sourceIds, revision: context.revision }
          check(request.expectedRevision)
          if (
            request.expectedRevision !== plan.visible.revision ||
            plan.checks.some((valid) => !valid())
          )
            throw new Error('预览或导入器已变化，请重新收集。')
          const chosen = plan.staged.filter((s) => selected.has(s.key)),
            known = new Map(
              context.library.value.sources.flatMap((s) =>
                s.document?.importKey ? [[s.document.importKey, s.id] as const] : [],
              ),
            ),
            mapping = new Map<string, string>(),
            additions: PreparedCollectionSource[] = []
          for (const item of chosen) {
            let sourceId = known.get(item.fingerprint)
            if (!sourceId) {
              sourceId = item.source.id
              known.set(item.fingerprint, sourceId)
              additions.push(item)
            }
            mapping.set(item.source.id, sourceId)
          }
          const available = new Set([
            ...context.library.value.sources.map((s) => s.id),
            ...mapping.values(),
          ])
          const uploads = new Map<string, MediaUpload>()
          for (const item of additions) {
            const source = { ...item.source }
            if (source.parentSourceId)
              source.parentSourceId = mapping.get(source.parentSourceId) ?? source.parentSourceId
            if (source.parentSourceId && !available.has(source.parentSourceId))
              throw new Error('请选择所属书籍或父材料。')
            if (source.studySequence)
              source.studySequence = {
                ...source.studySequence,
                groupId: mapping.get(source.studySequence.groupId) ?? source.studySequence.groupId,
              }
            item.source = sourceSchema.parse(source)
            item.assets.forEach((a) => uploads.set(a.meta.id, a))
          }
          const sourceIds = chosen.map((s) => mapping.get(s.source.id)!)
          await context.commit(
            (current) => {
              check(request.expectedRevision)
              if (plan.checks.some((valid) => !valid())) throw new Error('导入器已停用。')
              return {
                ...current,
                sources: [...current.sources, ...additions.map((s) => s.source)],
                media: [...current.media, ...[...uploads.values()].map((a) => a.meta)],
                materialReceipts: [
                  ...current.materialReceipts,
                  {
                    id,
                    pluginId: 'repeaty-collection',
                    operationId: request.operationId,
                    fingerprint,
                    kind: 'collect',
                    createdAt: new Date().toISOString(),
                    result: { sourceIds, noteIds: [] },
                  },
                ],
              }
            },
            { assets: [...uploads.values()], reason: '收集材料前', undoLabel: '收集材料' },
          )
          check()
          return { sourceIds, revision: context.revision }
        },
        async organizeInbox(input) {
          const request = mutation
            .extend({
              sourceId: z.string(),
              title: sourceDetailsSchema.shape.title.optional(),
              url: sourceDetailsSchema.shape.url.optional(),
              action: z.enum(['file', 'archive', 'restore']),
            })
            .parse(input)
          check(request.expectedRevision)
          await context.commit(
            (current) => {
              check(request.expectedRevision)
              const source = current.sources.find((s) => s.id === request.sourceId)
              if (!source?.inbox) throw new Error('收件箱项目已变化。')
              return {
                ...current,
                sources: current.sources.map((s) =>
                  s.id !== source.id
                    ? s
                    : sourceSchema.parse({
                        ...s,
                        title: request.title ?? s.title,
                        url: request.url ?? s.url,
                        inbox:
                          request.action === 'file'
                            ? undefined
                            : {
                                ...s.inbox,
                                state: request.action === 'archive' ? 'archived' : 'new',
                              },
                      }),
                ),
              }
            },
            { undoLabel: '整理收件箱' },
          )
          check()
          return { revision: context.revision }
        },
      }
    },
  }
}
