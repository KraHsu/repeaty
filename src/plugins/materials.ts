import { z } from 'zod'
import { markRaw, shallowReactive } from 'vue'
import type {
  SourceConnectorContribution,
  MaterialImporterContribution,
  MaterialReaderContribution,
  MaterialCommandContribution,
  MaterialSearchProviderContribution,
  MaterialTaskContext,
  MaterialHostApi,
  MaterialTaskOptions,
} from '@repeaty/plugin-api'
import { cancelledTask, retainTaskWork } from './tasks'

export type {
  SourceConnectorContribution,
  MaterialImporterContribution,
  MaterialReaderContribution,
  MaterialCommandContribution,
  MaterialSearchProviderContribution,
  MaterialHostApi,
} from '@repeaty/plugin-api'

export interface MaterialRegistrations {
  registerSourceConnector(contribution: SourceConnectorContribution): () => void
  registerImporter(contribution: MaterialImporterContribution): () => void
  registerReader(contribution: MaterialReaderContribution): () => void
  registerCommand(contribution: MaterialCommandContribution): () => void
  registerSearchProvider(contribution: MaterialSearchProviderContribution): () => void
}
export interface MaterialPluginIdentity {
  pluginId: string
  scope: string
  signal: AbortSignal
  worker?: boolean
  assertCurrent(): void
  runTask<T>(
    options: MaterialTaskOptions,
    run: (context: MaterialTaskContext) => Promise<T>,
  ): Promise<T>
}
export type PluginMaterialHostFactory = (plugin: MaterialPluginIdentity) => MaterialHostApi
function identity(value: { id: string; title: string }) {
  if (
    !value ||
    !/^[a-z][a-z0-9-]{0,63}$/.test(value.id) ||
    typeof value.title !== 'string' ||
    !value.title.trim() ||
    value.title.length > 200
  )
    throw new Error('插件材料扩展定义无效。')
}
function strings(values: readonly string[], validate: (value: string) => boolean) {
  return (
    Array.isArray(values) &&
    values.length > 0 &&
    values.length <= 32 &&
    values.every((value) => typeof value === 'string' && validate(value)) &&
    new Set(values).size === values.length
  )
}

/** Registrations are published only with their containing successful plugin activation. */
export function createMaterialRegistrations(current: () => boolean) {
  const connectors = shallowReactive<SourceConnectorContribution[]>([])
  const importers = shallowReactive<MaterialImporterContribution[]>([])
  const readers = shallowReactive<MaterialReaderContribution[]>([])
  const commands = shallowReactive<MaterialCommandContribution[]>([])
  const searchProviders = shallowReactive<MaterialSearchProviderContribution[]>([])
  const controllers = new Set<AbortController>()
  const check = () => {
    if (!current()) throw new Error('插件已卸载或学习库已切换。')
  }
  function register<T extends { id: string; title: string }>(
    entries: T[],
    contribution: T,
    capture: (signal: AbortSignal) => T,
  ) {
    check()
    identity(contribution)
    const controller = new AbortController()
    const entry = markRaw(capture(controller.signal))
    identity(entry)
    if (entries.some((value) => value.id === entry.id)) throw new Error('插件材料扩展标识重复。')
    controllers.add(controller)
    entries.push(entry)
    let active = true
    return () => {
      if (!active) return
      active = false
      controller.abort()
      controllers.delete(controller)
      const index = entries.indexOf(entry)
      if (index !== -1) entries.splice(index, 1)
    }
  }
  async function invoke<T, C extends MaterialTaskContext>(
    context: C,
    lifetime: AbortSignal,
    work: (context: C) => Promise<T>,
  ): Promise<T> {
    check()
    if (context.signal.aborted || lifetime.aborted) throw cancelledTask()
    const controller = new AbortController()
    const cleanups = new Set<() => void>()
    let finished = false
    let rejectAbort: (reason: unknown) => void = () => {}
    const abort = () => {
      controller.abort()
      rejectAbort(cancelledTask())
      cleanup()
    }
    const cleanup = () => {
      for (const stop of cleanups) {
        try {
          stop()
        } catch {
          /* continue */
        }
      }
      cleanups.clear()
    }
    context.signal.addEventListener('abort', abort, { once: true })
    lifetime.addEventListener('abort', abort, { once: true })
    const checkCall = () => {
      check()
      if (finished || controller.signal.aborted) throw cancelledTask()
    }
    const scoped = {
      ...context,
      signal: controller.signal,
      createWorker: context.createWorker
        ? (source: string, options?: { type?: 'classic' | 'module'; name?: string }) => {
            checkCall()
            return context.createWorker!(source, options)
          }
        : undefined,
      onCleanup(stop: () => void) {
        if (finished || controller.signal.aborted) {
          stop()
          return
        }
        cleanups.add(stop)
      },
      progress(value: Parameters<MaterialTaskContext['progress']>[0]) {
        checkCall()
        context.progress(value)
      },
      async yield() {
        checkCall()
        await context.yield()
        checkCall()
      },
    } as C
    try {
      const pending = Promise.resolve().then(() => {
        checkCall()
        return work(scoped)
      })
      retainTaskWork(context, pending)
      const result = await Promise.race([
        pending,
        new Promise<never>((_resolve, reject) => {
          rejectAbort = reject
        }),
      ])
      checkCall()
      return result
    } finally {
      finished = true
      context.signal.removeEventListener('abort', abort)
      lifetime.removeEventListener('abort', abort)
      cleanup()
    }
  }
  const registrations: MaterialRegistrations = {
    registerSourceConnector(contribution) {
      identity(contribution)
      const { id, title, kind, scan } = contribution
      const fields =
        contribution.fields &&
        z
          .array(
            z.strictObject({
              key: z
                .string()
                .regex(/^[a-z][a-zA-Z0-9-]{0,63}$/)
                .refine((k) => !['input', 'directoryId'].includes(k)),
              title: z.string().min(1).max(160),
              type: z.enum(['select', 'text']),
              options: z
                .array(
                  z.strictObject({ value: z.string().max(200), label: z.string().min(1).max(160) }),
                )
                .min(1)
                .max(50)
                .optional(),
              default: z.string().max(200).optional(),
            }),
          )
          .max(20)
          .parse(contribution.fields)
      const credentialHint = z.string().max(500).optional().parse(contribution.credentialHint)
      if (
        fields &&
        (new Set(fields.map((f) => f.key)).size !== fields.length ||
          fields.some(
            (f) =>
              f.type === 'select' &&
              (!f.options ||
                new Set(f.options.map((o) => o.value)).size !== f.options.length ||
                (f.default !== undefined && !f.options.some((o) => o.value === f.default))),
          ))
      )
        throw new Error('来源配置字段无效。')
      if (!['directory', 'remote', 'hybrid'].includes(kind) || typeof scan !== 'function')
        throw new Error('来源连接器定义无效。')
      return register(connectors, contribution, (signal) => ({
        id,
        title,
        kind,
        fields,
        credentialHint,
        scan: (request, context) =>
          invoke(context, signal, (scoped) => scan.call(contribution, request, scoped)),
      }))
    },
    registerImporter(contribution) {
      identity(contribution)
      const { id, title, parse } = contribution
      const extensions = [...contribution.extensions]
      if (
        !strings(extensions, (value) => /^\.[a-z0-9][a-z0-9.-]{0,31}$/.test(value)) ||
        typeof parse !== 'function'
      )
        throw new Error('材料导入器定义无效。')
      return register(importers, contribution, (signal) => ({
        id,
        title,
        extensions,
        parse: (file, context) =>
          invoke(context, signal, (scoped) => parse.call(contribution, file, scoped)),
      }))
    },
    registerReader(contribution) {
      identity(contribution)
      const { id, title, component, supportsTextLocation } = contribution
      const formats = [...contribution.formats]
      if (
        !strings(formats, (value) => /^[a-z0-9][a-z0-9.+_-]{0,63}$/.test(value)) ||
        (supportsTextLocation !== undefined && typeof supportsTextLocation !== 'boolean') ||
        !component ||
        Array.isArray(component) ||
        !['object', 'function'].includes(typeof component)
      )
        throw new Error('材料阅读器定义无效。')
      return register(readers, contribution, () => ({
        id,
        title,
        formats,
        component,
        supportsTextLocation,
      }))
    },
    registerCommand(contribution) {
      identity(contribution)
      const { id, title, run, shortcut, component } = contribution
      const formats = contribution.formats && [...contribution.formats]
      if (
        (typeof run === 'function') === !!component ||
        (run !== undefined && typeof run !== 'function') ||
        (component &&
          (Array.isArray(component) || !['object', 'function'].includes(typeof component))) ||
        (formats &&
          !strings(
            formats,
            (value) => value === '*' || /^[a-z0-9][a-z0-9.+_-]{0,63}$/.test(value),
          )) ||
        (shortcut !== undefined && (typeof shortcut !== 'string' || shortcut.length > 100))
      )
        throw new Error('插件命令定义无效。')
      return register(commands, contribution, (signal) => ({
        id,
        get title() {
          // A plugin can localize its label reactively; identity and executable
          // capabilities remain captured at registration time.
          try {
            const next = contribution.title
            return typeof next === 'string' && next.trim() && next.length <= 200 ? next : title
          } catch {
            return title
          }
        },
        shortcut,
        formats,
        component: component && markRaw(component),
        run:
          run && ((context) => invoke(context, signal, (scoped) => run.call(contribution, scoped))),
      }))
    },
    registerSearchProvider(contribution) {
      identity(contribution)
      const { id, title, search } = contribution
      if (typeof search !== 'function') throw new Error('材料搜索扩展定义无效。')
      return register(searchProviders, contribution, (signal) => ({
        id,
        title,
        search: (query, context) =>
          invoke(context, signal, (scoped) => search.call(contribution, query, scoped)),
      }))
    },
  }
  return {
    connectors,
    importers,
    readers,
    commands,
    searchProviders,
    registrations,
    dispose() {
      for (const controller of controllers) controller.abort()
      controllers.clear()
      connectors.splice(0)
      importers.splice(0)
      readers.splice(0)
      commands.splice(0)
      searchProviders.splice(0)
    },
  }
}
