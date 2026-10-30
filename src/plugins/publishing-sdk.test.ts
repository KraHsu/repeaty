import { expect, it, vi } from 'vitest'
import { createPluginApi } from './sdk'
import type { PublishingApi } from '@repeaty/plugin-api'
const native = vi.hoisted(() => {
  vi.resetModules()
  return vi.fn(async (..._args: unknown[]) => ({ status: 200, body: '{}' }))
})
vi.mock('@repeaty-plugin-host', () => ({
  callPluginHost: native,
  readPluginData: vi.fn(),
  writePluginData: vi.fn(),
}))
function setup() {
  let current = true
  const disposers: (() => void)[] = []
  const consent = vi.fn(async () => true)
  const host = {
    list: vi.fn(() => ({})),
    prepare: vi.fn(async () => ({})),
    asset: vi.fn(async () => new Blob()),
    validate: vi.fn(),
    release: vi.fn(),
  }
  const factory = vi.fn(() => host as unknown as PublishingApi)
  const sdk = createPluginApi(
    {
      id: 'publisher',
      name: 'Publisher',
      version: '1.0.0',
      kind: 'frontend',
      apiVersion: 1,
      dataVersion: 1,
      permissions: { network: true, secrets: true },
    },
    'scope',
    disposers,
    () => current,
    undefined,
    undefined,
    undefined,
    { publishingHost: () => factory, networkConsent: () => consent },
  )
  return {
    sdk,
    host,
    factory,
    consent,
    dispose: () => disposers.forEach((f) => f()),
    switch: () => {
      current = false
    },
  }
}
it('requires a host-confirmed HTTPS origin; direct native authorization is denied and grants are not repeatedly requested', async () => {
  native.mockClear()
  const t = setup()
  await expect(
    t.sdk.nativePlugin('network.authorize', { origin: 'https://example.org' }),
  ).rejects.toThrow('permission-denied')
  await expect(t.sdk.network.authorize('http://example.org')).rejects.toThrow('invalid-origin')
  t.consent.mockResolvedValueOnce(false)
  await expect(t.sdk.network.authorize('https://example.org')).rejects.toThrow('permission-denied')
  expect(native).not.toHaveBeenCalled()
  await t.sdk.network.authorize('https://example.org')
  await t.sdk.network.authorize('https://example.org')
  expect(t.consent).toHaveBeenCalledTimes(2)
  expect(native).toHaveBeenCalledOnce()
})
it('does not authorize an old activation after its confirmation resolves late', async () => {
  native.mockClear()
  const t = setup()
  let finish!: (value: boolean) => void
  t.consent.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  const pending = t.sdk.network.authorize('https://example.org')
  t.switch()
  finish(true)
  await expect(pending).rejects.toThrow('插件已卸载')
  expect(native).not.toHaveBeenCalled()
})
it('binds HTTP identity, cancels a pending request and rejects its late success', async () => {
  native.mockClear()
  const t = setup(),
    controller = new AbortController()
  let finish!: (value: { status: number; body: string }) => void
  native.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  const pending = t.sdk.network.request({ url: 'https://example.org' }, controller.signal)
  const payload = native.mock.calls[0]![2] as { activationId: string; requestId: string }
  expect(payload.activationId).toBeTypeOf('string')
  controller.abort()
  expect(native).toHaveBeenLastCalledWith(
    'publisher',
    'http.cancel',
    { activationId: payload.activationId, requestId: payload.requestId },
    'scope',
  )
  finish({ status: 200, body: '{}' })
  await expect(pending).rejects.toThrow()
  t.dispose()
  expect(native).toHaveBeenLastCalledWith(
    'publisher',
    'http.dispose',
    { activationId: payload.activationId },
    'scope',
  )
})
it('binds the public projection once and refuses late attachment results after disposal', async () => {
  const t = setup()
  t.sdk.publishing.list()
  let finish!: (value: Blob) => void
  t.host.asset.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  const pending = t.sdk.publishing.asset('snapshot', 'asset')
  t.dispose()
  finish(new Blob())
  await expect(pending).rejects.toThrow('插件已卸载')
  expect(t.factory).toHaveBeenCalledOnce()
})
