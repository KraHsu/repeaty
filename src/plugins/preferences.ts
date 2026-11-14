import { ref } from 'vue'
import { persistSetting, readSetting, writeSetting } from '../settings-store'
export const PLUGIN_PREFERENCES_KEY = 'repeaty.plugins.v1'
interface PluginPreferenceSettings {
  read: typeof readSetting
  write: typeof writeSetting
  /** Unlike the best-effort writer, this resolves only after durable completion. */
  persist?: (key: string, value: string) => void | Promise<void>
}
export function createPluginPreferences(
  settings: PluginPreferenceSettings = {
    read: readSetting,
    write: writeSetting,
    persist: persistSetting,
  },
) {
  const pluginPreferenceError = ref('')
  const pluginPreferences = ref<Record<string, boolean>>({})
  function restorePluginPreferences() {
    try {
      const value = JSON.parse(settings.read(PLUGIN_PREFERENCES_KEY) ?? '{}')
      pluginPreferences.value = Object.fromEntries(
        Object.entries(value ?? {}).filter(
          ([id, enabled]) => /^[a-z][a-z0-9-]{0,63}$/.test(id) && typeof enabled === 'boolean',
        ),
      ) as Record<string, boolean>
    } catch {
      pluginPreferences.value = {}
    }
  }
  function savePluginPreference(id: string, enabled: boolean) {
    pluginPreferences.value = { ...pluginPreferences.value, [id]: enabled }
    pluginPreferenceError.value = ''
    const fail = () => {
      pluginPreferenceError.value = '插件开关已生效，但未能保存；下次打开时可能恢复默认设置。'
    }
    try {
      settings.write(PLUGIN_PREFERENCES_KEY, JSON.stringify(pluginPreferences.value), fail)
    } catch {
      fail()
    }
  }
  /** The manager publishes state only after rechecking ownership of the learning library. */
  async function persistPluginPreferences(value: Record<string, boolean>) {
    // A fire-and-forget writer cannot establish a durable disabled state. Custom
    // adapters must provide their own persister instead of falling through to another store.
    if (!settings.persist) throw new Error('无法保存插件启停状态。')
    await settings.persist(PLUGIN_PREFERENCES_KEY, JSON.stringify(value))
  }
  function listenPluginPreferences() {
    restorePluginPreferences()
    const receive = (event: StorageEvent) => {
      if (event.key === null || event.key === PLUGIN_PREFERENCES_KEY) restorePluginPreferences()
    }
    window.addEventListener('storage', receive)
    return () => window.removeEventListener('storage', receive)
  }
  return {
    pluginPreferenceError,
    pluginPreferences,
    restorePluginPreferences,
    savePluginPreference,
    persistPluginPreferences,
    listenPluginPreferences,
  }
}
export const defaultPluginPreferences = createPluginPreferences()
export const {
  pluginPreferenceError,
  pluginPreferences,
  restorePluginPreferences,
  savePluginPreference,
  listenPluginPreferences,
} = defaultPluginPreferences
