import { expect, it, vi } from 'vitest'
import type { AutomationApi } from '@repeaty/plugin-api'
import { createPluginApi } from './sdk'
import type { PluginAutomationIdentity } from './automation'
const native = vi.hoisted(() => {
  vi.resetModules()
  return vi.fn(async (..._args: unknown[]) => ({}))
})
vi.mock('@repeaty-plugin-host', () => ({
  callPluginHost: native,
  readPluginData: vi.fn(),
  writePluginData: vi.fn(),
}))
function setup(models = false) {
  let active = true
  const disposers: (() => void)[] = []
  const host = {
    context: vi.fn(() => ({ sources: [], folders: [] })),
    capabilities: vi.fn(() => ({})),
    authorize: vi.fn(async () => ({ id: 'grant' })),
    revoke: vi.fn(),
    query: vi.fn(async () => ({})),
    preview: vi.fn(async () => ({})),
    apply: vi.fn(async () => ({})),
    operationStatus: vi.fn(async () => undefined),
  }
  const factory = vi.fn((_owner: PluginAutomationIdentity) => host as unknown as AutomationApi)
  const sdk = createPluginApi(
    {
      id: 'assistant',
      name: 'Assistant',
      version: '1.0.0',
      apiVersion: 1,
      dataVersion: 1,
      kind: 'frontend',
      permissions: { models },
    },
    'scope-a',
    disposers,
    () => active,
    undefined,
    undefined,
    undefined,
    { automationHost: () => factory },
  )
  return {
    sdk,
    host,
    factory,
    dispose: () => disposers.forEach((f) => f()),
    switchScope: () => {
      active = false
    },
  }
}
it('binds one activation to the host and delegates permission decisions to the host', async () => {
  const t = setup()
  await t.sdk.automation.authorize({ scope: { kind: 'all' }, write: true })
  await t.sdk.automation.query({ kind: 'sources' })
  t.sdk.automation.revoke()
  expect(t.factory).toHaveBeenCalledTimes(1)
  expect(t.factory.mock.calls[0]![0]).toMatchObject({
    pluginId: 'assistant',
    label: 'Assistant',
    scope: 'scope-a',
  })
  expect(t.host.authorize).toHaveBeenCalledWith({ scope: { kind: 'all' }, write: true })
  expect(t.host.revoke).toHaveBeenCalledOnce()
})
it.each(['dispose', 'switchScope'] as const)(
  'rejects delayed replies and further calls after %s',
  async (mode) => {
    const t = setup()
    let finish!: (value: object) => void
    t.host.query.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const pending = t.sdk.automation.query({ kind: 'library' })
    t[mode]()
    finish({})
    await expect(pending).rejects.toThrow('插件已卸载')
    await expect(t.sdk.automation.query({ kind: 'library' })).rejects.toThrow('插件已卸载')
  },
)
it('requires declared native model permission and overwrites caller-supplied activation IDs', async () => {
  native.mockClear()
  await expect(setup().sdk.nativePlugin('model.profiles.list', {})).rejects.toThrow(
    'permission-denied',
  )
  expect(native).not.toHaveBeenCalled()
  const t = setup(true)
  await t.sdk.nativePlugin('model.profiles.list', { activationId: 'spoof' })
  const payload = native.mock.calls[0]![2] as { activationId: string }
  expect(payload.activationId).not.toBe('spoof')
  t.dispose()
  expect(native).toHaveBeenLastCalledWith(
    'assistant',
    'model.dispose',
    { activationId: payload.activationId },
    'scope-a',
  )
})
