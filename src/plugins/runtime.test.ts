// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { PluginRuntime } from './runtime'
import type { PluginBundle } from './package'

const runtimes: PluginRuntime[] = []
const ownedIds = new Set<string>()
function runtime() {
  const value = new PluginRuntime()
  runtimes.push(value)
  return value
}
function bundle(id = 'example', styles = '.plugin-example { color: green }'): PluginBundle {
  ownedIds.add(id)
  return {
    manifest: { id, name: id, version: '2.3.4', apiVersion: 1, dataVersion: 1, kind: 'frontend' },
    main: 'independently built plugin entry',
    styles,
  }
}
function definition(id = 'example') {
  return { id, label: id, version: 1, kind: 'frontend', reviewPanel: { template: '<span />' } }
}
const styles = () =>
  [...document.head.querySelectorAll<HTMLStyleElement>('style[data-repeaty-plugin]')].filter(
    (style) => ownedIds.has(style.dataset.repeatyPlugin!),
  )
afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.close()))
  expect(styles()).toHaveLength(0)
  ownedIds.clear()
})

it('isolates installed definitions and cleanup between runtime instances', async () => {
  const externalStyles = [...document.head.querySelectorAll('style[data-repeaty-plugin]')]
  const first = runtime(),
    second = runtime()
  const firstStop = vi.fn(),
    secondStop = vi.fn()
  await first.load(bundle(), async () => ({ default: { ...definition(), dispose: firstStop } }))
  await second.load(bundle(), async () => ({ default: { ...definition(), dispose: secondStop } }))
  expect(first.installations).toHaveLength(1)
  expect(second.installations).toHaveLength(1)
  expect(first.installations).not.toBe(second.installations)
  await first.close()
  expect(first.installations).toHaveLength(0)
  expect(second.installations).toHaveLength(1)
  expect(firstStop).toHaveBeenCalledTimes(1)
  expect(secondStop).not.toHaveBeenCalled()
  expect(styles()).toHaveLength(1)
  expect(externalStyles.every((style) => style.isConnected)).toBe(true)
})

it('retains the working definition and styles when replacement activation fails', async () => {
  const value = runtime(),
    oldDispose = vi.fn(),
    failedCleanup = vi.fn()
  const original = await value.load(bundle(), async () => ({
    default: { ...definition(), dispose: oldDispose },
  }))
  await expect(
    value.load(bundle(), async (_code, disposers) => {
      disposers.push(failedCleanup)
      throw new Error('broken plugin update')
    }),
  ).rejects.toThrow('broken plugin update')
  expect(value.installations).toEqual([original])
  expect(styles()).toHaveLength(1)
  expect(styles()[0]!.textContent).toContain('green')
  expect(oldDispose).not.toHaveBeenCalled()
  expect(failedCleanup).toHaveBeenCalledTimes(1)
})

it('swaps an independently versioned update and releases the previous instance exactly once', async () => {
  const value = runtime(),
    oldDispose = vi.fn(),
    oldListener = vi.fn()
  await value.load(bundle(), async (_code, disposers) => {
    disposers.push(oldListener)
    return { default: { ...definition(), dispose: oldDispose } }
  })
  const updated = await value.load(
    bundle('example', '.plugin-example { color: blue }'),
    async () => ({
      default: { ...definition(), label: 'updated independently' },
    }),
  )
  expect(value.installations).toEqual([updated])
  expect(updated.plugin.version).toBe(1)
  expect(updated.plugin.label).toBe('updated independently')
  expect(styles()).toHaveLength(1)
  expect(styles()[0]!.textContent).toContain('blue')
  expect(oldDispose).toHaveBeenCalledTimes(1)
  expect(oldListener).toHaveBeenCalledTimes(1)
})

it('removes styles and all registered resources on unload without duplicate disposal', async () => {
  const value = runtime(),
    dispose = vi.fn(),
    first = vi.fn(),
    last = vi.fn()
  await value.load(bundle(), async (_code, disposers) => {
    disposers.push(
      first,
      () => {
        throw new Error('one cleanup failed')
      },
      last,
    )
    return { default: { ...definition(), dispose } }
  })
  await value.unload('example')
  await value.unload('example')
  await value.close()
  expect(value.installations).toHaveLength(0)
  expect(first).toHaveBeenCalledTimes(1)
  expect(last).toHaveBeenCalledTimes(1)
  expect(dispose).toHaveBeenCalledTimes(1)
  expect(styles()).toHaveLength(0)
})

it('rejects a module that finishes loading after its workspace closes and cleans its resources', async () => {
  const value = runtime(),
    cleanup = vi.fn(),
    dispose = vi.fn()
  let finish!: (module: { default: unknown }) => void
  const loading = value.load(bundle(), async (_code, disposers) => {
    disposers.push(cleanup)
    return new Promise((resolve) => {
      finish = resolve
    })
  })
  await value.close()
  const rejected = expect(loading).rejects.toThrow('学习库已切换')
  finish({ default: { ...definition(), dispose } })
  await rejected
  expect(value.installations).toHaveLength(0)
  expect(cleanup).toHaveBeenCalledTimes(1)
  expect(dispose).toHaveBeenCalledTimes(1)
})

it('does not let an old asynchronous factory replace a newly opened workspace definition', async () => {
  const value = runtime(),
    oldDispose = vi.fn()
  let finish!: (definition: unknown) => void
  const loading = value.load(bundle(), async () => ({
    default: () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  }))
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
  await value.close()
  const current = await value.load(bundle(), async () => ({
    default: { ...definition(), label: 'new workspace' },
  }))
  const rejected = expect(loading).rejects.toThrow('学习库已切换')
  finish({ ...definition(), dispose: oldDispose })
  await rejected
  expect(value.installations).toEqual([current])
  expect(styles()).toHaveLength(1)
  expect(oldDispose).toHaveBeenCalledTimes(1)
})

it('rejects mismatched identity, data compatibility and declared plugin kind', async () => {
  const value = runtime()
  for (const changed of [
    { id: 'other-plugin' },
    { version: 2 },
    { kind: 'local' },
    { label: '' },
    { reviewPanel: undefined },
  ])
    await expect(
      value.load(bundle(), async () => ({
        default: { ...definition(), ...changed },
      })),
    ).rejects.toThrow('插件定义与清单不一致')
  expect(value.installations).toHaveLength(0)
})

it('rejects reserved core identifiers before plugin code runs', async () => {
  const value = runtime(),
    evaluate = vi.fn(async () => ({ default: definition() }))
  for (const id of ['flashcard', 'unavailable'])
    await expect(value.load(bundle(id), evaluate)).rejects.toThrow()
  expect(evaluate).not.toHaveBeenCalled()
})

it('isolates a broken plugin from another installed plugin and from later valid loads', async () => {
  const value = runtime()
  const healthy = await value.load(bundle('healthy'), async () => ({
    default: definition('healthy'),
  }))
  await expect(
    value.load(bundle('broken'), async () => ({
      default: () => {
        throw new Error('activation failed')
      },
    })),
  ).rejects.toThrow('activation failed')
  expect(value.installations).toEqual([healthy])
  await value.load(bundle('next'), async () => ({ default: definition('next') }))
  expect(value.installations.map(({ plugin }) => plugin.id)).toEqual(['healthy', 'next'])
})

it('continues a valid update even if the old plugin cleanup rejects', async () => {
  const value = runtime()
  await value.load(bundle(), async () => ({
    default: { ...definition(), dispose: () => Promise.reject(new Error('broken old cleanup')) },
  }))
  await value.load(bundle(), async () => ({ default: { ...definition(), label: 'new version' } }))
  expect(value.installations).toHaveLength(1)
  expect(value.installations[0]!.plugin.label).toBe('new version')
  expect(styles()).toHaveLength(1)
})
