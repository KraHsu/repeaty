import { z } from 'zod'
import { pluginAssetsSchema } from './assets'

export const pluginIdSchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]{0,63}$/)
  .refine(
    (id) =>
      !['flashcard', 'unavailable'].includes(id) &&
      !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/.test(id),
    '插件标识为保留名称。',
  )
const authorSchema = z.string().trim().min(1).max(100)
export const manifestSchema = z
  .object({
    id: pluginIdSchema,
    name: z
      .string()
      .min(1)
      .max(100)
      .refine((value) => value.trim().length > 0),
    // Older installed packages remain readable; newly built/installed packages require an author.
    author: authorSchema.optional(),
    version: z
      .string()
      .max(64)
      .regex(/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/),
    apiVersion: z.literal(1),
    dataVersion: z.number().int().min(1).max(1000),
    kind: z.enum(['frontend', 'local']),
    description: z.string().max(2000).optional(),
    main: z.literal('main.js').optional(),
    permissions: z
      .object({
        origins: z
          .array(
            z
              .string()
              .url()
              .refine((value) => new URL(value).origin === value && value.startsWith('https://')),
          )
          .max(20)
          .refine((values) => new Set(values).size === values.length)
          .optional(),
        secrets: z.boolean().optional(),
        files: z.boolean().optional(),
        models: z.boolean().optional(),
        network: z.boolean().optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
export const bundleSchema = z
  .object({
    manifest: manifestSchema,
    main: z
      .string()
      .min(1)
      .max(4 * 1024 * 1024)
      .refine((value) => new TextEncoder().encode(value).length <= 4 * 1024 * 1024),
    styles: z
      .string()
      .max(1024 * 1024)
      .refine((value) => new TextEncoder().encode(value).length <= 1024 * 1024)
      .optional(),
    readme: z
      .string()
      .max(256 * 1024)
      .refine((value) => new TextEncoder().encode(value).length <= 256 * 1024)
      .optional(),
    assets: pluginAssetsSchema.optional(),
  })
  .strict()
export const installBundleSchema = bundleSchema.extend({
  manifest: manifestSchema.extend({ author: authorSchema }),
})
export type PluginManifest = z.infer<typeof manifestSchema>
export type PluginBundle = z.infer<typeof bundleSchema>
function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted)
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, child]) => [key, sorted(child)]),
    )
  return value
}
export async function packageHash(bundle: PluginBundle) {
  const value = sorted({
    manifest: bundle.manifest,
    main: bundle.main,
    styles: bundle.styles ?? '',
    ...(bundle.readme === undefined ? {} : { readme: bundle.readme }),
    ...(bundle.assets === undefined ? {} : { assets: bundle.assets }),
  })
  const hash = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(value)),
  )
  return Array.from(new Uint8Array(hash), (value) => value.toString(16).padStart(2, '0')).join('')
}
export async function readPluginFile(file: File): Promise<PluginBundle> {
  if (file.size > 40 * 1024 * 1024) throw new Error('插件包超过大小限制。')
  try {
    return installBundleSchema.parse(JSON.parse(await file.text()))
  } catch (error) {
    if (error instanceof z.ZodError) throw new Error(pluginIssueMessage(error))
    throw new Error('插件包格式或 API 版本不受支持。')
  }
}

/** Translate host failures at the management UI boundary; plugin APIs retain their error codes. */
export function pluginIssueMessage(issue: unknown): string {
  if (issue instanceof z.ZodError) {
    if (issue.issues.some(({ path }) => path[0] === 'manifest' && path[1] === 'author'))
      return '插件包必须提供作者（author），长度为 1–100 个字符。'
    return '插件包格式或 API 版本不受支持。'
  }
  const message = issue instanceof Error ? issue.message : String(issue)
  const messages: Record<string, string> = {
    'invalid-plugin': '插件包格式或 API 版本不受支持。',
    'plugin-limit': '插件包超过大小限制。',
    'plugin-unavailable': '插件包不存在。',
    'plugin-not-trusted': '此设备尚未信任此插件包。启用前请确认代码来源。',
    'plugin-file-changed': '插件文件已变化，请重新扫描后再试。',
    'unsafe-plugin-file': '插件目录包含链接或不支持的文件，请检查后重新安装。',
    'permission-denied': '无法访问插件文件，请检查文件夹权限。',
    'plugin-storage-error': '无法读写插件文件，请检查磁盘空间和文件权限。',
    'stale-workspace-session': '学习库已切换，请重新打开当前内容。',
  }
  return messages[message] ?? message
}
