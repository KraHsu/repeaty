// Unit tests supply their own host boundary; plugin source never imports application files.
const settings = new Map<string, string>()
export const readSetting = (key: string) => settings.get(key) ?? null
export const writeSetting = (key: string, value: string) => {
  settings.set(key, value)
}
export const pluginData = {
  async get(_id: string, _scope: string): Promise<unknown> {
    throw new Error('Mock pluginData explicitly in storage tests')
  },
  async set(_id: string, _value: unknown, _scope: string): Promise<void> {
    throw new Error('Mock pluginData explicitly in storage tests')
  },
}
export async function nativePlugin<T>(_operation: string, _payload: unknown): Promise<T> {
  throw new Error('Mock nativePlugin explicitly in native bridge tests')
}
