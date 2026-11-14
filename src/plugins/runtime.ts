import { markRaw, shallowReactive } from 'vue'
import type { PluginInstallation, PluginDefinition } from './types'
import { createMaterialRegistrations, type MaterialRegistrations } from './materials'
import { bundleSchema, type PluginBundle } from './package'
import { assertPluginSupported } from './retired-official'
import {
  validateSettingsContribution,
  type PluginSettingsContribution,
  type RegisterPluginSettings,
} from './settings'
import {
  validatePageContribution,
  type PluginPageContribution,
  type RegisterPluginPage,
} from './pages'
import {
  validateWidgetContribution,
  type PluginWidgetContribution,
  type RegisterPluginWidget,
} from './widgets'

export interface ActivePlugin {
  bundle: PluginBundle
  installation: PluginInstallation
  dispose: () => Promise<void>
}
export type PluginModule = { default: unknown }
function validViewValue(key: PropertyKey, value: unknown): boolean {
  switch (key) {
    case 'title':
      return typeof value === 'string' && !!value.trim()
    case 'description':
      return value === undefined || typeof value === 'string'
    case 'icon':
      if (value === undefined) return true
    // Icons and view components share the supported Vue component forms.
    case 'component':
      return !!value && !Array.isArray(value) && ['object', 'function'].includes(typeof value)
    case 'placement':
      return value === 'overview.after-decks' || value === 'overview.bottom'
    default:
      return false
  }
}
export class PluginRuntime {
  readonly installations = shallowReactive<PluginInstallation[]>([])
  private active = new Map<string, ActivePlugin>()
  private loading = new Map<string, symbol>()
  private generation = 0
  async load(
    raw: PluginBundle,
    evaluate: (
      code: string,
      disposers: (() => void)[],
      registerSettings: RegisterPluginSettings,
      registerPage: RegisterPluginPage,
      registerWidget: RegisterPluginWidget,
      materials: MaterialRegistrations,
    ) => Promise<PluginModule>,
  ) {
    const bundle = bundleSchema.parse(raw)
    assertPluginSupported(bundle.manifest.id)
    if (['flashcard', 'unavailable'].includes(bundle.manifest.id))
      throw new Error('插件标识为保留名称。')
    const epoch = this.generation
    const activation = Symbol(bundle.manifest.id)
    this.loading.set(bundle.manifest.id, activation)
    const disposers: (() => void)[] = []
    const settings = shallowReactive<PluginSettingsContribution[]>([])
    const pages = shallowReactive<PluginPageContribution[]>([])
    const widgets = shallowReactive<PluginWidgetContribution[]>([])
    let styles: HTMLStyleElement | undefined
    let definition: PluginDefinition | undefined
    let installation: PluginInstallation | undefined
    let published = false
    let explicitSettings = false
    let disposed = false
    const current = () =>
      !disposed &&
      epoch === this.generation &&
      (published
        ? this.active.get(bundle.manifest.id)?.installation === installation
        : this.loading.get(bundle.manifest.id) === activation)
    const materials = createMaterialRegistrations(current)
    const registerSettings: RegisterPluginSettings = (contribution) => {
      if (!current()) throw new Error('插件已卸载或学习库已切换。')
      validateSettingsContribution(contribution)
      if (settings.some((entry) => entry.id === contribution.id))
        throw new Error('插件设置标识重复。')
      explicitSettings = true
      // Each registration is a separate lifetime, even when a plugin reuses its declaration.
      // Evaluate getters against the source so class-private state and reactive reads still work.
      const registration = markRaw(
        new Proxy(contribution, {
          get: (target, key) => Reflect.get(target, key, target),
        }),
      )
      settings.push(registration)
      let registered = true
      return () => {
        if (!registered) return
        registered = false
        const index = settings.indexOf(registration)
        if (index !== -1) settings.splice(index, 1)
      }
    }
    const dispose = async () => {
      if (disposed) return
      disposed = true
      settings.splice(0)
      pages.splice(0)
      widgets.splice(0)
      materials.dispose()
      if (this.loading.get(bundle.manifest.id) === activation)
        this.loading.delete(bundle.manifest.id)
      styles?.remove()
      for (const stop of disposers.splice(0)) {
        try {
          stop()
        } catch {
          /* cleanup continues */
        }
      }
      await definition?.dispose?.()
    }
    function registerView<T extends { id: string }>(
      entries: T[],
      contribution: T,
      validate: (value: T) => void,
      duplicateMessage: string,
      keys: readonly (keyof T)[],
    ) {
      if (!current()) throw new Error('插件已卸载或学习库已切换。')
      validate(contribution)
      const id = contribution.id
      if (entries.some((entry) => entry.id === id)) throw new Error(duplicateMessage)
      const values = new Map(keys.map((key) => [key, Reflect.get(contribution, key, contribution)]))
      // Validate the captured snapshot too: a getter may change or throw between reads.
      validate({ id, ...Object.fromEntries(values) } as T)
      // Route identity belongs to this registration. Reactive titles and views still
      // read from their source, but changing the source ID cannot move a live route.
      const registration = markRaw(
        Object.defineProperties(
          { id },
          Object.fromEntries(
            keys.map((key) => [
              key,
              {
                enumerable: true,
                get: () => {
                  try {
                    const next = Reflect.get(contribution, key, contribution)
                    if (validViewValue(key, next)) values.set(key, next)
                  } catch {
                    // The shell reads metadata outside the plugin render boundary.
                    // Preserve its last valid value while tracking reactive reads.
                  }
                  return values.get(key)
                },
              },
            ]),
          ),
        ) as T,
      )
      entries.push(registration)
      let registered = true
      return () => {
        if (!registered) return
        registered = false
        const index = entries.indexOf(registration)
        if (index !== -1) entries.splice(index, 1)
      }
    }
    const registerPage: RegisterPluginPage = (contribution) =>
      registerView(pages, contribution, validatePageContribution, '插件页面标识重复。', [
        'title',
        'description',
        'icon',
        'component',
      ])
    const registerWidget: RegisterPluginWidget = (contribution) =>
      registerView(widgets, contribution, validateWidgetContribution, '插件组件标识重复。', [
        'title',
        'placement',
        'component',
      ])
    try {
      const module = await evaluate(
        bundle.main,
        disposers,
        registerSettings,
        registerPage,
        registerWidget,
        materials.registrations,
      )
      const exported =
        typeof module.default === 'function' ? await module.default() : module.default
      if (!exported || typeof exported !== 'object') throw new Error('插件入口必须导出插件定义。')
      definition = exported as PluginDefinition
      if (
        definition.id !== bundle.manifest.id ||
        definition.kind !== bundle.manifest.kind ||
        definition.version !== bundle.manifest.dataVersion ||
        !definition.label ||
        !(
          ('showQuestion' in definition && definition.showQuestion && definition.showAnswer) ||
          ('reviewPanel' in definition && definition.reviewPanel) ||
          ('type' in definition &&
            definition.type === 'extension' &&
            (pages.length > 0 ||
              widgets.length > 0 ||
              materials.importers.length > 0 ||
              materials.connectors.length > 0 ||
              materials.readers.length > 0 ||
              materials.commands.length > 0 ||
              materials.searchProviders.length > 0))
        )
      )
        throw new Error('插件定义与清单不一致。')
      if (!current()) throw new Error('学习库已切换，插件加载已取消。')
      if (!explicitSettings && 'settings' in definition && definition.settings) {
        const plugin = definition
        registerSettings({
          id: 'legacy',
          get title() {
            return plugin.label
          },
          get description() {
            return plugin.description
          },
          component: plugin.settings,
        })
      }
      if (bundle.styles && typeof document !== 'undefined') {
        styles = document.createElement('style')
        styles.dataset.repeatyPlugin = definition.id
        styles.textContent = bundle.styles
        document.head.append(styles)
      }
      installation = {
        plugin: markRaw(definition),
        instanceId: crypto.randomUUID(),
        settings,
        pages,
        widgets,
        importers: materials.importers,
        connectors: materials.connectors,
        readers: materials.readers,
        commands: materials.commands,
        searchProviders: materials.searchProviders,
        enabledByDefault: true,
      }
      const previous = this.active.get(definition.id)
      const index = this.installations.findIndex(({ plugin }) => plugin.id === definition!.id)
      if (index === -1) this.installations.push(installation)
      else this.installations.splice(index, 1, installation)
      this.active.set(definition.id, { bundle, installation, dispose })
      published = true
      if (this.loading.get(bundle.manifest.id) === activation)
        this.loading.delete(bundle.manifest.id)
      if (previous) await previous.dispose().catch(() => {})
      return installation
    } catch (error) {
      await dispose().catch(() => {})
      throw error
    }
  }
  async unload(id: string) {
    this.loading.delete(id)
    const loaded = this.active.get(id)
    this.active.delete(id)
    const index = this.installations.findIndex(({ plugin }) => plugin.id === id)
    if (index !== -1) this.installations.splice(index, 1)
    await loaded?.dispose()
  }
  async close() {
    this.generation++
    this.loading.clear()
    await Promise.allSettled([...this.active.keys()].map((id) => this.unload(id)))
  }
}
