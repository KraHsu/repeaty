import { expect, it, vi } from 'vitest'
import { createMaterialRegistrations, type MaterialPluginIdentity } from './materials'
import { PluginRuntime } from './runtime'
import { createPluginApi } from './sdk'
import { PluginTaskScheduler } from './tasks'
import type {
  MaterialHostApi,
  MaterialTaskContext,
  MaterialImporterContribution,
} from '@repeaty/plugin-api'
import type { PluginBundle } from './package'

const candidate = {
  key: 'chapter',
  title: 'Chapter',
  text: 'Content',
  format: 'plain' as const,
  documentFormat: 'study-json',
}
const importer = (
  parse: MaterialImporterContribution['parse'] = async () => [candidate],
): MaterialImporterContribution => ({
  id: 'study-json',
  title: 'Study',
  extensions: ['.study.json'],
  parse,
})
const context = (): MaterialTaskContext => ({
  signal: new AbortController().signal,
  progress: vi.fn(),
  onCleanup: vi.fn(),
  yield: async () => {},
})
const bundle = (version = '1.0.0'): PluginBundle => ({
  manifest: {
    id: 'material-example',
    name: 'Example',
    version,
    apiVersion: 1,
    dataVersion: 1,
    kind: 'frontend',
  },
  main: 'independent code',
})
const definition = {
  id: 'material-example',
  label: 'Example',
  kind: 'frontend',
  version: 1,
  type: 'extension',
}

it('freezes parser identity and extension snapshots and rejects duplicate or invalid contributions', () => {
  const registry = createMaterialRegistrations(() => true)
  const original = importer()
  const remove = registry.registrations.registerImporter(original)
  original.id = 'changed'
  ;(original.extensions as string[]).push('.other')
  expect(registry.importers[0]!.id).toBe('study-json')
  expect(registry.importers[0]!.extensions).toEqual(['.study.json'])
  expect(() => registry.registrations.registerImporter(importer())).toThrow('标识重复')
  expect(() =>
    registry.registrations.registerImporter({ ...importer(), extensions: ['*'] }),
  ).toThrow('定义无效')
  remove()
  remove()
  expect(registry.importers).toHaveLength(0)
})

it('cancels a parser on unregister and ignores its late value without leaking resources', async () => {
  const registry = createMaterialRegistrations(() => true)
  let resolve!: (value: readonly (typeof candidate)[]) => void
  let task!: MaterialTaskContext
  const cleanup = vi.fn()
  const remove = registry.registrations.registerImporter(
    importer(async (ctxFile) => {
      throw Error(ctxFile.name)
    }),
  )
  remove()
  const stop = registry.registrations.registerImporter(
    importer(async (_file, ctx) => {
      task = ctx
      ctx.onCleanup(cleanup)
      return new Promise((done) => {
        resolve = done
      })
    }),
  )
  const pending = registry.importers[0]!.parse(new File(['x'], 'x.study.json'), context())
  await Promise.resolve()
  const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  stop()
  await rejected
  expect(task.signal.aborted).toBe(true)
  expect(cleanup).toHaveBeenCalledTimes(1)
  expect(() => task.progress({ completed: 1 })).toThrow()
  resolve([candidate])
  await Promise.resolve()
  expect(cleanup).toHaveBeenCalledTimes(1)
})

it('does not free a queue slot when a cancelled registry parser ignores its abort signal', async () => {
  const registry = createMaterialRegistrations(() => true)
  const scheduler = new PluginTaskScheduler(1)
  const lifetime = new AbortController()
  let resolve!: (value: readonly (typeof candidate)[]) => void
  let started = false
  const remove = registry.registrations.registerImporter(
    importer(async () => {
      started = true
      return new Promise((done) => {
        resolve = done
      })
    }),
  )
  const first = scheduler.run(
    Symbol(),
    { id: 'first', title: 'First' },
    (ctx) => registry.importers[0]!.parse(new File(['x'], 'x.study.json'), { ...ctx }),
    lifetime.signal,
  )
  await vi.waitFor(() => expect(started).toBe(true))
  const rejected = expect(first).rejects.toMatchObject({ name: 'AbortError' })
  remove()
  await rejected
  const nextRun = vi.fn(async () => 'next')
  const next = scheduler.run(Symbol(), { id: 'next', title: 'Next' }, nextRun, lifetime.signal)
  await new Promise((done) => setTimeout(done, 0))
  expect(nextRun).not.toHaveBeenCalled()
  resolve([candidate])
  expect(await next).toBe('next')
})

it('publishes material-only extensions atomically and keeps working readers after a failed replacement', async () => {
  const runtime = new PluginRuntime()
  const first = await runtime.load(
    bundle(),
    async (_code, _dispose, _settings, _pages, _widgets, materials) => {
      materials.registerImporter(importer())
      materials.registerReader({
        id: 'chapter',
        title: 'Reader',
        formats: ['study-json'],
        component: { render: () => null },
      })
      return { default: definition }
    },
  )
  expect(first.importers).toHaveLength(1)
  await expect(
    runtime.load(
      bundle('2.0.0'),
      async (_code, _dispose, _settings, _pages, _widgets, materials) => {
        materials.registerImporter(importer())
        throw Error('bad update')
      },
    ),
  ).rejects.toThrow('bad update')
  expect(runtime.installations[0]).toBe(first)
  expect(await first.importers![0]!.parse(new File(['x'], 'x.study.json'), context())).toEqual([
    candidate,
  ])
  await runtime.unload('material-example')
  expect(first.importers).toHaveLength(0)
  expect(first.readers).toHaveLength(0)
})

it('guards bound material host before and after awaits and cancels tasks when the plugin is disposed', async () => {
  const disposers: (() => void)[] = []
  let resolve!: (
    value: ReturnType<MaterialHostApi['list']> extends Promise<infer T> ? T : never,
  ) => void
  const list = vi.fn(
    () =>
      new Promise<Awaited<ReturnType<MaterialHostApi['list']>>>((done) => {
        resolve = done
      }),
  )
  const factory = vi.fn(
    (_plugin: MaterialPluginIdentity) => ({ list }) as unknown as MaterialHostApi,
  )
  const api = createPluginApi(
    bundle().manifest,
    'library-a',
    disposers,
    () => true,
    undefined,
    undefined,
    undefined,
    { host: () => factory },
  )
  const pending = api.materials.list()
  expect(factory.mock.calls[0]![0]).toMatchObject({
    pluginId: 'material-example',
    scope: 'library-a',
  })
  const rejected = expect(pending).rejects.toThrow('插件已卸载')
  for (const stop of disposers) stop()
  resolve([])
  await rejected
  expect(() => api.materials.snapshot()).toThrow('插件已卸载')
})
