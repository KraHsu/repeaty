import { markRaw, shallowReactive } from 'vue'
import type { PluginInstallation, QuestionPlugin, ReviewPanelPlugin } from './types'
import { bundleSchema, type PluginBundle } from './package'

export interface ActivePlugin {
  bundle: PluginBundle
  installation: PluginInstallation
  dispose: () => Promise<void>
}
export type PluginModule = { default: unknown }
export class PluginRuntime {
  readonly installations = shallowReactive<PluginInstallation[]>([])
  private active = new Map<string, ActivePlugin>()
  private generation = 0
  async load(
    raw: PluginBundle,
    evaluate: (code: string, disposers: (() => void)[]) => Promise<PluginModule>,
  ) {
    const bundle = bundleSchema.parse(raw)
    if (['flashcard', 'unavailable'].includes(bundle.manifest.id))
      throw new Error('插件标识为保留名称。')
    const epoch = this.generation
    const disposers: (() => void)[] = []
    let styles: HTMLStyleElement | undefined
    let definition: QuestionPlugin | ReviewPanelPlugin | undefined
    let disposed = false
    const dispose = async () => {
      if (disposed) return
      disposed = true
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
      const module = await evaluate(bundle.main, disposers)
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
      if (epoch !== this.generation) throw new Error('学习库已切换，插件加载已取消。')
      if (bundle.styles && typeof document !== 'undefined') {
        styles = document.createElement('style')
        styles.dataset.repeatyPlugin = definition.id
        styles.textContent = bundle.styles
        document.head.append(styles)
      }
      const installation: PluginInstallation = {
        plugin: markRaw(definition),
        enabledByDefault: true,
      }
      const previous = this.active.get(definition.id)
      const index = this.installations.findIndex(({ plugin }) => plugin.id === definition!.id)
      if (index === -1) this.installations.push(installation)
      else this.installations.splice(index, 1, installation)
      this.active.set(definition.id, { bundle, installation, dispose })
      if (previous) await previous.dispose().catch(() => {})
      return installation
    } catch (error) {
      await dispose().catch(() => {})
      throw error
    }
  }
  async unload(id: string) {
    const loaded = this.active.get(id)
    this.active.delete(id)
    const index = this.installations.findIndex(({ plugin }) => plugin.id === id)
    if (index !== -1) this.installations.splice(index, 1)
    await loaded?.dispose()
  }
  async close() {
    this.generation++
    await Promise.allSettled([...this.active.keys()].map((id) => this.unload(id)))
  }
}
