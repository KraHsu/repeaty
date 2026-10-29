import { afterEach, expect, it, vi } from 'vitest'
import { externalPlugins } from '../../build/external-plugins'
import { officialPluginBundles } from './manager'
import { bundleSchema, type PluginBundle } from './package'
import { createPluginApi, evaluatePlugin } from './sdk'

afterEach(() => vi.restoreAllMocks())

const bundle = (id: string): PluginBundle => ({
  manifest: { id, name: id, version: '1.0.0', apiVersion: 1, dataVersion: 1, kind: 'frontend' },
  main: 'export default {}',
})

it('offers optional official packages without fetching or installing them as defaults', async () => {
  const catalog = [
    { path: 'plugins/review-history.repeaty-plugin' },
    { path: 'plugins/review-heatmap.repeaty-plugin', installByDefault: false },
  ]
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

it('rejects catalog paths outside packaged plugin assets', async () => {
  const fetch = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(new Response(JSON.stringify([{ path: '../private.repeaty-plugin' }])))
  await expect(officialPluginBundles()).rejects.toThrow('插件目录清单无效。')
  expect(fetch).toHaveBeenCalledTimes(1)
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
    const catalog = JSON.parse(files.get('plugins/catalog.json')!) as {
      id: string
      path: string
      installByDefault: boolean
    }[]
    expect(catalog.find(({ id }) => id === 'review-heatmap')).toMatchObject({
      path: 'plugins/review-heatmap.repeaty-plugin',
      installByDefault: false,
    })
    expect(catalog.filter(({ installByDefault }) => installByDefault).map(({ id }) => id)).toEqual(
      desktop ? ['review-history', 'leetcode'] : ['review-history'],
    )
    const heatmap = bundleSchema.parse(
      JSON.parse(files.get('plugins/review-heatmap.repeaty-plugin')!),
    )
    expect(heatmap.manifest).toMatchObject({
      id: 'review-heatmap',
      version: '1.1.0',
      kind: 'frontend',
      description: '在学习概览中以日历热力图展示最近 365 天的正式评分次数。',
    })
    expect(heatmap.manifest.permissions).toBeUndefined()
    expect(heatmap.readme).toContain('复习热力图')
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
