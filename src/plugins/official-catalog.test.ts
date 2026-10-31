import { afterEach, expect, it, vi } from 'vitest'
import { externalPlugins } from '../../build/external-plugins'
import {
  officialPluginBundles,
  officialPluginCatalog,
  loadOfficialPlugin,
  type OfficialPluginEntry,
} from './manager'
import { bundleSchema, installBundleSchema, type PluginBundle } from './package'
import { createPluginApi, evaluatePlugin } from './sdk'

afterEach(() => vi.restoreAllMocks())

const bundle = (id: string): PluginBundle => ({
  manifest: { id, name: id, version: '1.0.0', apiVersion: 1, dataVersion: 1, kind: 'frontend' },
  main: 'export default {}',
})
const entry = (id: string, installByDefault?: boolean): OfficialPluginEntry => ({
  ...bundle(id).manifest,
  path: `plugins/${id}.repeaty-plugin`,
  ...(installByDefault === undefined ? {} : { installByDefault }),
})

it('loads only manifests while browsing, then fetches exactly the selected package without executing it', async () => {
  const catalog = [entry('review-history'), entry('pdf-reader', false)]
  const selected = { ...bundle('pdf-reader'), main: 'throw new Error("do not execute")' }
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    if (url.endsWith('catalog.json')) return new Response(JSON.stringify(catalog))
    if (url.endsWith('pdf-reader.repeaty-plugin')) return new Response(JSON.stringify(selected))
    throw new Error(`Unexpected package fetch: ${url}`)
  })
  const result = await officialPluginCatalog()
  expect(result).toEqual(catalog)
  expect(fetch).toHaveBeenCalledExactlyOnceWith('/plugins/catalog.json')
  expect(await loadOfficialPlugin(result[1]!)).toEqual(selected)
  expect(fetch.mock.calls.map(([url]) => String(url))).toEqual([
    '/plugins/catalog.json',
    '/plugins/pdf-reader.repeaty-plugin',
  ])
})

it('offers optional official packages without fetching or installing them as defaults', async () => {
  const catalog = [entry('review-history'), entry('review-heatmap', false)]
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    const body = url.endsWith('catalog.json')
      ? catalog
      : bundle(url.includes('review-heatmap') ? 'review-heatmap' : 'review-history')
    return new Response(JSON.stringify(body))
  })
  expect(
    (await officialPluginBundles({ defaultsOnly: true })).map(({ manifest }) => manifest.id),
  ).toEqual(['review-history'])
  expect(fetch.mock.calls.map(([url]) => String(url))).not.toContain(
    '/plugins/review-heatmap.repeaty-plugin',
  )
  expect((await officialPluginBundles()).map(({ manifest }) => manifest.id)).toEqual([
    'review-history',
    'review-heatmap',
  ])
})

it.each([
  null,
  {},
  [null],
  [{ path: 'plugins/review-history.repeaty-plugin' }],
  [{ ...entry('review-history'), path: '../private.repeaty-plugin' }],
  [{ ...entry('review-history'), path: 'https://example.org/plugin.repeaty-plugin' }],
  [{ ...entry('review-history'), path: 'plugins/another.repeaty-plugin' }],
  [{ ...entry('review-history'), path: 'plugins/review-history.repeaty-plugin?download=1' }],
  [{ ...entry('review-history'), version: 'invalid' }],
  [{ ...entry('review-history'), apiVersion: 2 }],
  [{ ...entry('review-history'), installByDefault: 'true' }],
  [entry('review-history'), entry('review-history', false)],
])(
  'rejects an invalid or duplicate directory before downloading any packages (%#)',
  async (catalog) => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify(catalog)))
    await expect(officialPluginBundles()).rejects.toThrow('插件目录清单无效。')
    expect(fetch).toHaveBeenCalledTimes(1)
  },
)

it('rejects a tampered selected path before making a request', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch')
  await expect(
    loadOfficialPlugin({ ...entry('review-history'), path: '../private.repeaty-plugin' }),
  ).rejects.toThrow('插件目录清单无效。')
  expect(fetch).not.toHaveBeenCalled()
})

it.each([
  { id: 'another' },
  { version: '1.0.1' },
  { kind: 'local' },
  { permissions: { network: true } },
])('rejects a package that no longer matches the browsed manifest (%#)', async (difference) => {
  const value = bundle('review-history')
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({ ...value, manifest: { ...value.manifest, ...difference } })),
  )
  await expect(loadOfficialPlugin(entry('review-history'))).rejects.toThrow(
    '官方插件包与目录信息不一致',
  )
})

it('captures the selected identity before an asynchronous package response', async () => {
  const selected = entry('review-history')
  let finish!: (response: Response) => void
  vi.spyOn(globalThis, 'fetch').mockImplementation(
    () => new Promise<Response>((resolve) => (finish = resolve)),
  )
  const loading = loadOfficialPlugin(selected)
  selected.version = '1.0.1'
  finish(new Response(JSON.stringify(bundle('review-history'))))
  expect((await loading).manifest.version).toBe('1.0.0')
})

it('reports catalog and package failures without returning partial content', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 503 }))
  await expect(officialPluginCatalog()).rejects.toThrow('无法读取官方插件包。')
  await expect(loadOfficialPlugin(entry('review-history'))).rejects.toThrow('无法读取官方插件包。')
  fetch.mockResolvedValueOnce(new Response('{broken json'))
  await expect(officialPluginCatalog()).rejects.toThrow()
  fetch.mockResolvedValueOnce(
    new Response(JSON.stringify({ manifest: bundle('review-history').manifest })),
  )
  await expect(loadOfficialPlugin(entry('review-history'))).rejects.toThrow()
})

it.each([false, true])(
  'ships the standalone heatmap package as an optional asset (desktop=%s)',
  async (desktop) => {
    const files = new Map<string, string>()
    const plugin = externalPlugins(desktop)
    const hook = plugin.generateBundle!
    const generate = typeof hook === 'function' ? hook : hook.handler
    await generate.call(
      {
        emitFile(asset: { fileName: string; source: string }) {
          files.set(asset.fileName, asset.source)
        },
      } as never,
      {} as never,
      {} as never,
      false,
    )
    const catalog = JSON.parse(files.get('plugins/catalog.json')!) as OfficialPluginEntry[]
    for (const { path, installByDefault: _default, ...manifest } of catalog) {
      const bundled = installBundleSchema.parse(JSON.parse(files.get(path)!))
      expect(bundled.manifest).toEqual(manifest)
      expect(manifest.author).toBe('repeaty')
    }
    for (const retired of ['static-publish', 'wordpress-publish', 'discourse-publish']) {
      expect(catalog.some(({ id }) => id === retired)).toBe(false)
      expect(files.has(`plugins/${retired}.repeaty-plugin`)).toBe(false)
    }
    expect(catalog.find(({ id }) => id === 'review-heatmap')).toMatchObject({
      version: '1.1.2',
      path: 'plugins/review-heatmap.repeaty-plugin',
      installByDefault: false,
    })
    expect(catalog.find(({ id }) => id === 'format-cleanup')).toMatchObject({
      path: 'plugins/format-cleanup.repeaty-plugin',
      installByDefault: false,
    })
    expect(catalog.find(({ id }) => id === 'web-lookup')).toMatchObject({
      path: 'plugins/web-lookup.repeaty-plugin',
      installByDefault: false,
    })
    const lookup = bundleSchema.parse(JSON.parse(files.get('plugins/web-lookup.repeaty-plugin')!))
    expect(lookup.manifest).toMatchObject({ id: 'web-lookup', version: '1.0.1', kind: 'frontend' })
    expect(lookup.manifest.permissions).toBeUndefined()
    expect(lookup.readme).toContain('选区查询')
    const cleanup = bundleSchema.parse(
      JSON.parse(files.get('plugins/format-cleanup.repeaty-plugin')!),
    )
    expect(cleanup.manifest).toMatchObject({
      id: 'format-cleanup',
      version: '1.0.2',
      kind: 'frontend',
    })
    expect(cleanup.manifest.permissions).toBeUndefined()
    expect(cleanup.readme).toContain('材料版本')
    expect(catalog.filter(({ installByDefault }) => installByDefault).map(({ id }) => id)).toEqual(
      desktop ? ['review-history', 'leetcode'] : ['review-history'],
    )
    const heatmap = bundleSchema.parse(
      JSON.parse(files.get('plugins/review-heatmap.repeaty-plugin')!),
    )
    expect(heatmap.manifest).toMatchObject({
      id: 'review-heatmap',
      version: '1.1.2',
      kind: 'frontend',
      description: '在学习概览中以日历热力图展示最近 365 天的正式评分次数。',
    })
    expect(heatmap.manifest.permissions).toBeUndefined()
    expect(heatmap.readme).toContain('复习热力图')
    expect(heatmap.readme).toContain('安装完成后插件保持关闭')
    expect(heatmap.readme).not.toContain('安装或更新官方插件')
    const page = vi.fn(() => () => {}),
      widget = vi.fn(() => () => {})
    const disposers: (() => void)[] = []
    const api = createPluginApi(
      heatmap.manifest,
      'local:catalog-test',
      disposers,
      () => true,
      undefined,
      page,
      widget,
    )
    try {
      const module = await evaluatePlugin(heatmap.main, api)
      const definition = await (module.default as () => unknown)()
      expect(definition).toMatchObject({ id: 'review-heatmap', type: 'extension' })
      expect(page).not.toHaveBeenCalled()
      expect(widget).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          id: 'daily-reviews',
          placement: 'overview.after-decks',
        }),
      )
    } finally {
      for (const dispose of disposers) dispose()
    }
  },
)
