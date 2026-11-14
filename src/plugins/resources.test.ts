import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPluginResources } from './resources'
import { bundleSchema, packageHash } from './package'

afterEach(() => vi.unstubAllGlobals())
const manifest = {
  id: 'asset-test',
  name: 'Assets',
  version: '1.0.0',
  apiVersion: 1 as const,
  dataVersion: 1,
  kind: 'frontend' as const,
}
describe('offline package resources', () => {
  it('rejects unsafe paths, malformed bytes and excessive decoded assets', () => {
    for (const path of [
      '../worker.js',
      '/absolute',
      'a\\b',
      'a//b',
      'a/./b',
      'a/con.ttf',
      'a/b.',
      '',
    ])
      expect(
        bundleSchema.safeParse({
          manifest,
          main: 'x',
          assets: { [path]: { type: 'text/javascript', base64: 'YQ==' } },
        }).success,
      ).toBe(false)
    expect(
      bundleSchema.safeParse({
        manifest,
        main: 'x',
        assets: { 'a.js': { type: 'text/javascript', base64: '!!' } },
      }).success,
    ).toBe(false)
    const asset = {
      type: 'application/octet-stream',
      base64: 'AAAA'.repeat((8 * 1024 * 1024) / 3 + 1),
    }
    expect(
      bundleSchema.safeParse({ manifest, main: 'x', assets: { 'a.bin': asset } }).success,
    ).toBe(false)
  })
  it('trusts resource bytes and retains the original hash for assetless packages', async () => {
    const bundle = { manifest, main: 'x' }
    expect(await packageHash(bundle)).toBe(await packageHash({ ...bundle, assets: undefined }))
    expect(await packageHash(bundle)).not.toBe(await packageHash({ ...bundle, assets: {} }))
    const asset = { type: 'text/javascript', base64: 'YQ==' }
    expect(await packageHash({ ...bundle, assets: { 'a.js': asset } })).not.toBe(
      await packageHash({ ...bundle, assets: { 'a.js': { ...asset, base64: 'Yg==' } } }),
    )
  })
  it('owns URLs/workers per reader, releases on disable and rejects stale calls', async () => {
    const revoked = vi.fn(),
      terminated = vi.fn()
    vi.stubGlobal(
      'Worker',
      class {
        terminate = terminated
      },
    )
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => `blob:${Math.random()}`),
      revokeObjectURL: revoked,
    })
    const lifetime = new AbortController()
    const resources = createPluginResources(
      { 'worker.js': { type: 'text/javascript', base64: 'YQ==' } },
      lifetime.signal,
      () => lifetime.signal.throwIfAborted(),
    )
    const a = resources.createScope(),
      b = resources.createScope()
    expect(await resources.read('worker.js')!.text()).toBe('a')
    expect(resources.read('missing.js')).toBeUndefined()
    expect(a.url('worker.js')).toBe(a.url('worker.js'))
    expect(a.url('worker.js')).not.toBe(b.url('worker.js'))
    a.createWorker('postMessage(1)')
    const cleanup = vi.fn()
    a.onCleanup(cleanup)
    a.dispose()
    a.dispose()
    expect(cleanup).toHaveBeenCalledOnce()
    expect(terminated).toHaveBeenCalledOnce()
    expect(revoked).toHaveBeenCalledTimes(2)
    expect(() => a.url('worker.js')).toThrow()
    lifetime.abort()
    expect(b.signal.aborted).toBe(true)
    expect(revoked).toHaveBeenCalledTimes(3)
    expect(() => resources.createScope()).toThrow()
    expect(() => resources.read('worker.js')).toThrow()
  })
})
