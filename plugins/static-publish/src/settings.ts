import { pluginData, publishing } from '@repeaty/plugin-api'
import { defaultTheme } from './theme'
import { publicUrl, type SiteOptions, type SiteTheme } from './model'
import type { CloudflareTarget } from './cloudflare/client'
import { targetKey } from './cloudflare/client'
export interface Config {
  version: 1
  options: SiteOptions
  theme: SiteTheme
  publicFields: string[]
  target: CloudflareTarget
}
export const defaults = (): Config => ({
  version: 1,
  options: { title: '学习札记', description: '', url: '', pageSize: 10 },
  theme: defaultTheme(),
  publicFields: [],
  target: { accountId: '', projectName: '', branch: 'main', credentialSlot: 'cloudflare-pages' },
})
export async function loadConfig() {
  const scope = publishing.list().workspaceScope
  const value = (await pluginData.get('config-v1', scope)) as Config | undefined
  if (value === undefined || value === null) return defaults()
  if (
    value.version !== 1 ||
    !value.options ||
    !value.theme ||
    !value.target ||
    !Array.isArray(value.publicFields)
  )
    throw new Error('发布配置无法读取，未重置原数据。')
  return value
}
export function validateConfig(config: Config) {
  const { options, theme } = config
  if (
    !options.title.trim() ||
    options.title.length > 160 ||
    options.description.length > 1000 ||
    !Number.isInteger(options.pageSize) ||
    options.pageSize < 1 ||
    options.pageSize > 50
  )
    throw new Error('请检查站点标题、说明和每页数量。')
  publicUrl(options.url)
  if (
    Object.values(theme).some(
      (value) => typeof value !== 'string' || new TextEncoder().encode(value).length > 256 * 1024,
    )
  )
    throw new Error('每份主题文件须小于 256 KiB。')
  if (
    config.publicFields.length > 64 ||
    config.publicFields.some((key) => !key || key.length > 100)
  )
    throw new Error('公开字段名称无效。')
}
export async function checkTargetChange(target: CloudflareTarget) {
  const scope = publishing.list().workspaceScope
  const pending = (await pluginData.get('deployment-v1', scope)) as
    { phase?: string; targetKey?: string } | undefined
  if (
    pending?.phase &&
    ['submitting', 'unknown', 'deploying', 'deleting'].includes(pending.phase)
  ) {
    let next = ''
    try {
      next = targetKey(target)
    } catch {
      /* Pending target cannot be cleared. */
    }
    if (next !== pending.targetKey)
      throw new Error('上次部署或删除结果尚未确定，请先核对原目标，再更换连接。')
  }
}
export async function saveConfig(config: Config) {
  validateConfig(config)
  await checkTargetChange(config.target)
  const scope = publishing.list().workspaceScope
  await pluginData.set('config-v1', JSON.parse(JSON.stringify(config)), scope)
}
