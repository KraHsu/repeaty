import { ref } from 'vue'
import { readSetting, writeSetting } from '../settings-store'
export const PLUGIN_PREFERENCES_KEY = 'repeaty.plugins.v1'
export function createPluginPreferences(settings = { read: readSetting, write: writeSetting }) {
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
