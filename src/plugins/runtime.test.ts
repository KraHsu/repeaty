// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { computed, ref, shallowRef } from 'vue'
import { PluginRuntime } from './runtime'
import type { PluginBundle } from './package'
import type { RegisterPluginSettings, PluginSettingsContribution } from './settings'
import type { RegisterPluginPage, PluginPageContribution } from './pages'
import type { RegisterPluginWidget, PluginWidgetContribution } from './widgets'

const runtimes: PluginRuntime[] = []

it.each(['static-publish', 'wordpress-publish', 'discourse-publish'])(
  'never evaluates a previously installed %s package or registers its views',
  async (id) => {
    const value = runtime()
    const evaluate = vi.fn(async () => ({ default: definition(id) }))
    await expect(value.load(bundle(id), evaluate)).rejects.toThrow('网站发布功能已移除')
    expect(evaluate).not.toHaveBeenCalled()
    expect(value.installations).toHaveLength(0)
    expect(styles()).toHaveLength(0)
  },
)
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

const settingsEntry = (id = 'display'): PluginSettingsContribution => ({
  id,
  title: 'Display',
  fields: [
    { key: 'enabled', type: 'switch', label: 'Enabled', modelValue: true, onChange: vi.fn() },
  ],
})

const pageEntry = (id = 'dashboard'): PluginPageContribution => ({
  id,
  title: 'Dashboard',
  component: { render: () => null },
})
const pageDefinition = (id = 'example') => ({
  type: 'extension',
  id,
  kind: 'frontend',
  label: 'Independent pages',
  version: 1,
})
const widgetEntry = (id = 'heatmap'): PluginWidgetContribution => ({
  id,
  title: 'Review activity',
  placement: 'overview.after-decks',
  component: { render: () => null },
})

it('keeps the last valid page metadata when getters throw or become invalid and resumes reactive updates', async () => {
  const value = runtime()
  const originalView = { render: () => null }
  const originalIcon = { render: () => null }
  const metadata = shallowRef<Record<string, unknown>>({
    title: 'Initial title',
    description: 'Initial description',
    component: originalView,
    icon: originalIcon,
  })
  const failing = ref(false)
  const source = Object.defineProperties(
    { id: 'dashboard' },
    Object.fromEntries(
      ['title', 'description', 'component', 'icon'].map((key) => [
        key,
        {
          get: () => {
            if (failing.value) throw new Error('Broken plugin metadata')
            return metadata.value[key]
          },
        },
      ]),
    ),
  ) as PluginPageContribution
  const installed = await value.load(bundle(), async (_code, _disposers, _settings, register) => {
    register(source)
    return { default: pageDefinition() }
  })
  const page = installed.pages![0]!
  const visible = computed(() => [page.title, page.description, page.component, page.icon])
  expect(visible.value).toEqual([
    'Initial title',
    'Initial description',
    originalView,
    originalIcon,
  ])
  failing.value = true
  expect(() => visible.value).not.toThrow()
  expect(visible.value).toEqual([
    'Initial title',
    'Initial description',
    originalView,
    originalIcon,
  ])
  failing.value = false
  metadata.value = { title: ' ', description: 42, component: null, icon: [] }
  expect(visible.value).toEqual([
    'Initial title',
    'Initial description',
    originalView,
    originalIcon,
  ])
  const updatedView = () => null
  metadata.value = { title: 'Recovered title', component: updatedView }
  expect(visible.value).toEqual(['Recovered title', undefined, updatedView, undefined])
  expect(installed.pages).toEqual([page])
})

it('keeps widget placement and views usable after invalid getters and accepts later valid changes', async () => {
  const value = runtime()
  const original = widgetEntry()
  const metadata = shallowRef<Record<string, unknown>>({ ...original })
  const failing = ref(false)
  const source = Object.defineProperties(
    { id: original.id },
    Object.fromEntries(
      ['title', 'placement', 'component'].map((key) => [
        key,
        {
          get: () => {
            if (failing.value) throw new Error('Broken widget metadata')
            return metadata.value[key]
          },
        },
      ]),
    ),
  ) as PluginWidgetContribution
  const installed = await value.load(
    bundle(),
    async (_code, _disposers, _settings, _page, register) => {
      register(source)
      return { default: pageDefinition() }
    },
  )
  const widget = installed.widgets![0]!
  const visible = computed(() => [widget.title, widget.placement, widget.component])
  expect(visible.value).toEqual([original.title, original.placement, original.component])
  failing.value = true
  expect(() => visible.value).not.toThrow()
  expect(visible.value).toEqual([original.title, original.placement, original.component])
  failing.value = false
  metadata.value = { title: null, placement: 'review.answers', component: [] }
  expect(visible.value).toEqual([original.title, original.placement, original.component])
  const recovered = () => null
  metadata.value = { title: 'Recovered widget', placement: 'overview.bottom', component: recovered }
  expect(visible.value).toEqual(['Recovered widget', 'overview.bottom', recovered])
})

it('activates widget-only extensions, isolates duplicate identifiers, and disposes repeated registrations independently', async () => {
  const value = runtime()
  let register!: RegisterPluginWidget
  let remove!: () => void
  const source = widgetEntry()
  const installed = await value.load(
    bundle(),
    async (_code, _disposers, _settings, _pages, callback) => {
      register = callback
      remove = register(source)
      return { default: pageDefinition() }
    },
  )
  expect(installed.pages).toHaveLength(0)
  expect(installed.widgets?.map(({ id }) => id)).toEqual(['heatmap'])
  expect(() => register(widgetEntry())).toThrow('标识重复')
  const first = installed.widgets![0]!
  remove()
  register(source)
  const next = installed.widgets![0]!
  expect(next).not.toBe(first)
  remove()
  expect(installed.widgets).toEqual([next])
  const second = await value.load(
    bundle('other'),
    async (_code, _disposers, _settings, _pages, callback) => {
      callback(widgetEntry())
      return { default: pageDefinition('other') }
    },
  )
  await value.unload('example')
  expect(installed.widgets).toHaveLength(0)
  expect(second.widgets).toHaveLength(1)
  expect(() => register(widgetEntry('late'))).toThrow('已卸载')
})

it('stages widget updates and keeps existing widgets when activation fails', async () => {
  const value = runtime()
  const original = await value.load(
    bundle(),
    async (_code, _disposers, _settings, _pages, register) => {
      register(widgetEntry())
      return { default: definition() }
    },
  )
  let late!: RegisterPluginWidget
  await expect(
    value.load(bundle(), async (_code, _disposers, _settings, _pages, register) => {
      late = register
      register(widgetEntry('replacement'))
      expect(value.installations).toEqual([original])
      throw new Error('Widget update failed')
    }),
  ).rejects.toThrow('Widget update failed')
  expect(original.widgets?.map(({ id }) => id)).toEqual(['heatmap'])
  expect(() => late(widgetEntry('late'))).toThrow('已卸载')
  const updated = await value.load(
    bundle(),
    async (_code, _disposers, _settings, _pages, register) => {
      register(widgetEntry('updated'))
      return { default: definition() }
    },
  )
  expect(original.widgets).toHaveLength(0)
  expect(updated.widgets?.map(({ id }) => id)).toEqual(['updated'])
})

it('publishes page-only plugins after activation and keeps page identifiers scoped to each plugin', async () => {
  const value = runtime()
  let finish!: () => void
  const pending = value.load(bundle(), async (_code, _disposers, _settings, register) => {
    register(pageEntry())
    return {
      default: async () => {
        await new Promise<void>((resolve) => {
          finish = resolve
        })
        return pageDefinition()
      },
    }
  })
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
  expect(value.installations).toHaveLength(0)
  finish()
  const installed = await pending
  expect(installed.pages?.map(({ id }) => id)).toEqual(['dashboard'])
  const other = await value.load(
    bundle('other'),
    async (_code, _disposers, _settings, register) => {
      register(pageEntry())
      return { default: pageDefinition('other') }
    },
  )
  expect(value.installations).toEqual([installed, other])
  await expect(
    value.load(bundle('empty'), async () => ({ default: pageDefinition('empty') })),
  ).rejects.toThrow('插件定义与清单不一致')
  expect(value.installations).toEqual([installed, other])
})

it('preserves a page registration identity while reactive metadata and repeated removals stay independent', async () => {
  const value = runtime()
  const title = ref('Dashboard')
  const source = {
    ...pageEntry(),
    get title() {
      return title.value
    },
  }
  let register!: RegisterPluginPage
  let remove!: () => void
  const installed = await value.load(bundle(), async (_code, _disposers, _settings, callback) => {
    register = callback
    remove = register(source)
    return { default: pageDefinition() }
  })
  const first = installed.pages![0]!
  const currentTitle = computed(() => installed.pages?.[0]?.title)
  title.value = 'Updated dashboard'
  expect(currentTitle.value).toBe('Updated dashboard')
  source.id = 'mutated-source-id'
  expect(first.id).toBe('dashboard')
  expect(() => register(pageEntry())).toThrow('标识重复')
  remove()
  expect(installed.pages).toHaveLength(0)
  source.id = 'dashboard'
  const removeNew = register(source)
  const second = installed.pages![0]!
  expect(second).not.toBe(first)
  remove()
  expect(installed.pages).toEqual([second])
  removeNew()
  removeNew()
  expect(installed.pages).toHaveLength(0)
  await value.unload('example')
  expect(() => register(pageEntry())).toThrow('已卸载')
})

it('retains old pages after a failed update and retires their registration API only after a successful swap', async () => {
  const value = runtime()
  let registerOld!: RegisterPluginPage
  let registerFailed!: RegisterPluginPage
  const old = await value.load(bundle(), async (_code, _disposers, _settings, register) => {
    registerOld = register
    register(pageEntry())
    return { default: pageDefinition() }
  })
  await expect(
    value.load(bundle(), async (_code, _disposers, _settings, register) => {
      registerFailed = register
      register(pageEntry('failed'))
      throw new Error('Cannot activate update')
    }),
  ).rejects.toThrow('Cannot activate update')
  expect(value.installations).toEqual([old])
  expect(old.pages?.map(({ id }) => id)).toEqual(['dashboard'])
  expect(() => registerFailed(pageEntry('late'))).toThrow('已卸载')
  const removeOld = registerOld(pageEntry('still-active'))
  const updated = await value.load(bundle(), async (_code, _disposers, _settings, register) => {
    register(pageEntry('new'))
    return { default: pageDefinition() }
  })
  expect(old.pages).toHaveLength(0)
  expect(updated.pages?.map(({ id }) => id)).toEqual(['new'])
  removeOld()
  expect(updated.pages).toHaveLength(1)
  expect(() => registerOld(pageEntry('late'))).toThrow('已卸载')
})

it('rejects late page registrations and async activation from a closed workspace', async () => {
  const value = runtime()
  let finish!: () => void
  let stale!: RegisterPluginPage
  const pending = value.load(bundle(), async (_code, _disposers, _settings, register) => {
    stale = register
    register(pageEntry())
    return {
      default: async () => {
        await new Promise<void>((resolve) => {
          finish = resolve
        })
        return pageDefinition()
      },
    }
  })
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
  await value.close()
  const fresh = await value.load(bundle(), async (_code, _disposers, _settings, register) => {
    register(pageEntry('fresh'))
    return { default: pageDefinition() }
  })
  expect(() => stale(pageEntry('late'))).toThrow('已卸载')
  finish()
  await expect(pending).rejects.toThrow('已切换')
  expect(value.installations).toEqual([fresh])
  expect(fresh.pages?.map(({ id }) => id)).toEqual(['fresh'])
})

it('publishes settings only after a successful activation and retains them after a failed update', async () => {
  const value = runtime()
  const original = await value.load(bundle(), async (_code, _disposers, register) => {
    register(settingsEntry())
    expect(value.installations).toHaveLength(0)
    return { default: definition() }
  })
  expect(original.settings).toHaveLength(1)
  await expect(
    value.load(bundle(), async (_code, _disposers, register) => {
      register(settingsEntry('replacement'))
      throw new Error('bad activation')
    }),
  ).rejects.toThrow('bad activation')
  expect(value.installations).toEqual([original])
  expect(original.settings?.[0]?.id).toBe('display')
})

it('owns asynchronous registrations, idempotent removal and duplicate ids for each active instance', async () => {
  const value = runtime()
  let register!: RegisterPluginSettings
  const installed = await value.load(bundle(), async (_code, _disposers, callback) => {
    register = callback
    return { default: definition() }
  })
  await Promise.resolve()
  const remove = register(settingsEntry())
  expect(() => register(settingsEntry())).toThrow('标识重复')
  expect(installed.settings).toHaveLength(1)
  remove()
  const removeNext = register(settingsEntry())
  remove()
  expect(installed.settings).toHaveLength(1)
  removeNext()
  expect(installed.settings).toHaveLength(0)
  register(settingsEntry())
  await value.unload('example')
  expect(installed.settings).toHaveLength(0)
  expect(() => register(settingsEntry())).toThrow('已卸载')
})

it('gives reused declarations distinct registration lifetimes while preserving getter receivers and reactivity', async () => {
  const value = runtime()
  let register!: RegisterPluginSettings
  const installed = await value.load(bundle(), async (_code, _disposers, callback) => {
    register = callback
    return { default: definition() }
  })
  class Declaration implements PluginSettingsContribution {
    readonly id = 'display'
    readonly fields = settingsEntry().fields
    #title = ref('Initial display')
    get title() {
      return this.#title.value
    }
    rename(next: string) {
      this.#title.value = next
    }
  }
  const source = new Declaration()
  const remove = register(source)
  const first = installed.settings![0]!
  expect(first).not.toBe(source)
  const title = computed(() => first.title)
  expect(title.value).toBe('Initial display')
  source.rename('Updated display')
  expect(title.value).toBe('Updated display')
  remove()
  register(source)
  const second = installed.settings![0]!
  expect(second).not.toBe(first)
  expect(second).not.toBe(source)
  expect(second.title).toBe('Updated display')
  remove()
  expect(installed.settings).toEqual([second])
})

it('cancels staged settings when the library closes during an asynchronous plugin factory', async () => {
  const value = runtime()
  let finish!: () => void
  let register!: RegisterPluginSettings
  const pending = value.load(bundle(), async (_code, _disposers, callback) => {
    register = callback
    register(settingsEntry())
    return {
      default: async () => {
        await new Promise<void>((resolve) => {
          finish = resolve
        })
        return definition()
      },
    }
  })
  await Promise.resolve()
  await value.close()
  expect(() => register(settingsEntry('late'))).toThrow('已卸载')
  finish()
  await expect(pending).rejects.toThrow('已切换')
  expect(value.installations).toHaveLength(0)
})

it('places legacy views in the settings registry while explicit registrations take precedence', async () => {
  const value = runtime()
  const view = { template: '<div>Legacy settings</div>' }
  const legacy = await value.load(bundle(), async () => ({
    default: { ...definition(), settings: view },
  }))
  expect(legacy.settings?.[0]?.component).toBe(view)
  expect(legacy.settings?.[0]?.title).toBe('example')
  const modern = await value.load(bundle(), async (_code, _disposers, register) => {
    register(settingsEntry())
    return { default: { ...definition(), settings: view } }
  })
  expect(modern.settings?.map(({ id }) => id)).toEqual(['display'])
  expect(legacy.settings).toHaveLength(0)
})
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
