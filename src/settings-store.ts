/** Workspace preferences use this adapter; secrets never enter it. */
export interface SettingsStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void | Promise<void>
}
let store: SettingsStore | undefined
export function useSettingsStore(value: SettingsStore) {
  store = value
}
export function readSetting(key: string) {
  return (store ?? localStorage).getItem(key)
}
export function writeSetting(key: string, value: string, onError: () => void = () => {}) {
  const saved = (store ?? localStorage).setItem(key, value)
  if (saved instanceof Promise) void saved.catch(onError)
}
/** Explicit save flows only report success after the selected adapter has persisted the value. */
export async function persistSetting(key: string, value: string): Promise<void> {
  await (store ?? localStorage).setItem(key, value)
}
