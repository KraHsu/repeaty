import { z } from 'zod'

export const MAX_PLUGIN_ASSET_BYTES = 8 * 1024 * 1024
export const MAX_PLUGIN_ASSETS_BYTES = 24 * 1024 * 1024
export const pluginAssetPathSchema = z
  .string()
  .min(1)
  .max(240)
  .refine((path) =>
    path
      .split('/')
      .every(
        (part) =>
          /^[a-zA-Z0-9_][a-zA-Z0-9_.-]*$/.test(part) &&
          !part.endsWith('.') &&
          !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
      ),
  )
export function base64Size(value: string) {
  return (value.length / 4) * 3 - (value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0)
}
function validBase64(value: string) {
  if (value.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) return false
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  if (value.endsWith('==')) return alphabet.indexOf(value.at(-3)!) % 16 === 0
  if (value.endsWith('=')) return alphabet.indexOf(value.at(-2)!) % 4 === 0
  return true
}
export const pluginAssetsSchema = z
  .record(
    pluginAssetPathSchema,
    z.strictObject({
      type: z
        .string()
        .regex(/^[a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+$/)
        .max(100),
      base64: z
        .string()
        .max(Math.ceil(MAX_PLUGIN_ASSET_BYTES / 3) * 4)
        .refine(validBase64)
        .refine((value) => base64Size(value) <= MAX_PLUGIN_ASSET_BYTES),
    }),
  )
  .refine(
    (assets) =>
      Object.keys(assets).length <= 2000 &&
      Object.values(assets).reduce((sum, asset) => sum + base64Size(asset.base64), 0) <=
        MAX_PLUGIN_ASSETS_BYTES,
  )
export type PluginAssets = z.infer<typeof pluginAssetsSchema>
