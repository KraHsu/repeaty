import { markRaw, shallowReactive } from 'vue'
import type { PluginInstallation, QuestionPlugin, ReviewPanelPlugin } from './types'
import { bundleSchema, type PluginBundle } from './package'
import {
  validateSettingsContribution,
  type PluginSettingsContribution,
  type RegisterPluginSettings,
} from './settings'

export interface ActivePlugin {
  bundle: PluginBundle
  installation: PluginInstallation
  dispose: () => Promise<void>
}
export type PluginModule = { default: unknown }
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
    ) => Promise<PluginModule>,
  ) {
    const bundle = bundleSchema.parse(raw)
    if (['flashcard', 'unavailable'].includes(bundle.manifest.id))
      throw new Error('插件标识为保留名称。')
    const epoch = this.generation
    const activation = Symbol(bundle.manifest.id)
    this.loading.set(bundle.manifest.id, activation)
    const disposers: (() => void)[] = []
    const settings = shallowReactive<PluginSettingsContribution[]>([])
    let styles: HTMLStyleElement | undefined
    let definition: QuestionPlugin | ReviewPanelPlugin | undefined
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
    try {
      const module = await evaluate(bundle.main, disposers, registerSettings)
      const exported =
        typeof module.default === 'function' ? await module.default() : module.default
      if (!exported || typeof exported !== 'object') throw new Error('插件入口必须导出插件定义。')
      definition = exported as QuestionPlugin | ReviewPanelPlugin
      if (
        definition.id !== bundle.manifest.id ||
        definition.kind !== bundle.manifest.kind ||
        definition.version !== bundle.manifest.dataVersion ||
        !definition.label ||
        !(
          ('showQuestion' in definition && definition.showQuestion && definition.showAnswer) ||
          ('reviewPanel' in definition && definition.reviewPanel)
        )
      )
        throw new Error('插件定义与清单不一致。')
      if (!current()) throw new Error('学习库已切换，插件加载已取消。')
      if (!explicitSettings && definition.settings) {
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
        settings,
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
