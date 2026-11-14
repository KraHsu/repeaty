import { reactive, readonly, ref } from 'vue'
import { readSetting, writeSetting } from '@repeaty/plugin-api'

interface HistoryPreferences {
  historyLength: number
  historyAfterReveal: boolean
}
const defaults: HistoryPreferences = { historyLength: 10, historyAfterReveal: true }
const state = reactive({ ...defaults })
let initialized = false
export const preferences = readonly(state)
export const preferenceError = ref('')

export function restorePreferences() {
  initialized = true
  try {
    const value = JSON.parse(readSetting('preferences') ?? '{}')
    Object.assign(state, {
      historyLength:
        Number.isInteger(value?.historyLength) &&
        value.historyLength >= 1 &&
        value.historyLength <= 50
          ? value.historyLength
          : defaults.historyLength,
      historyAfterReveal:
        typeof value?.historyAfterReveal === 'boolean'
          ? value.historyAfterReveal
          : defaults.historyAfterReveal,
    })
  } catch {
    Object.assign(state, defaults)
  }
}
export function initializePreferences() {
  if (!initialized) restorePreferences()
}
export function setPreference<K extends keyof HistoryPreferences>(
  key: K,
  value: HistoryPreferences[K],
) {
  if (
    (key === 'historyLength' &&
      (!Number.isInteger(value) || Number(value) < 1 || Number(value) > 50)) ||
    (key === 'historyAfterReveal' && typeof value !== 'boolean')
  )
    return false
  const next = { ...state, [key]: value }
  Object.assign(state, next)
  preferenceError.value = ''
  const failed = () => {
    preferenceError.value = '设置已生效，但未能保存；下次打开时可能恢复默认设置。'
  }
  try {
    writeSetting('preferences', JSON.stringify(next), failed)
  } catch {
    failed()
  }
  return true
}
