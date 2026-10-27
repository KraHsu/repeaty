import { readSetting, writeSetting } from './settings-store'
import { reactive, readonly, ref } from 'vue'
import { z } from 'zod'

export const PREFERENCES_KEY = 'repeaty.preferences.v1'
export const notificationLevels = ['info', 'warning', 'error'] as const
export type NotificationLevel = (typeof notificationLevels)[number]
const schema = z.object({
  popupInfo: z.boolean().catch(true),
  popupWarning: z.boolean().catch(true),
  popupError: z.boolean().catch(true),
})
type Preferences = z.infer<typeof schema>
const state = reactive(schema.parse({}))
export const preferences = readonly(state)
export const preferenceError = ref('')
export function restorePreferences() {
  try {
    Object.assign(state, schema.parse(JSON.parse(readSetting(PREFERENCES_KEY) ?? '{}')))
  } catch {
    Object.assign(state, schema.parse({}))
  }
}
export function setPreference<K extends keyof Preferences>(key: K, value: Preferences[K]) {
  const result = schema.safeParse({ ...state, [key]: value })
  if (!result.success || result.data[key] !== value) return false
  Object.assign(state, result.data)
  preferenceError.value = ''
  try {
    writeSetting(PREFERENCES_KEY, JSON.stringify(state), () => {
      preferenceError.value = '设置已生效，但未能保存；下次打开时可能恢复默认设置。'
    })
  } catch {
    preferenceError.value = '设置已生效，但未能保存；下次打开时可能恢复默认设置。'
  }
  return true
}
export function listenPreferences() {
  restorePreferences()
  const receive = (event: StorageEvent) => {
    if (event.key === null || event.key === PREFERENCES_KEY) restorePreferences()
  }
  window.addEventListener('storage', receive)
  return () => window.removeEventListener('storage', receive)
}
export function popupEnabled(level: NotificationLevel) {
  return level === 'info'
    ? state.popupInfo
    : level === 'warning'
      ? state.popupWarning
      : state.popupError
}
