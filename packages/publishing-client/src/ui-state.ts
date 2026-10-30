import {
  locale,
  network,
  nativePlugin,
  pluginData,
  publishing,
  type PluginHttpRequest,
} from '@repeaty/plugin-api'
import type { Connection, Ledger, Store, Native } from './types'
import { emptyLedger } from './engine'
import { record, siteUrl } from './util'

export const t = (zh: string, en: string) => (!locale.value.startsWith('zh') ? en : zh)
export const native: Native = (operation, payload, signal) =>
  operation === 'http'
    ? network.request(payload as PluginHttpRequest, signal)
    : operation === 'http.cancel'
      ? Promise.resolve(undefined)
      : nativePlugin(operation, payload)
export async function authorize(connection: Connection) {
  await network.authorize(new URL(connection.site).origin)
}
export async function loadConnection(scope: string): Promise<Connection | undefined> {
  const raw = await pluginData.get('connection', scope)
  if (raw === undefined || raw === null) return undefined
  const value = record(raw)
  if (
    typeof value.site !== 'string' ||
    typeof value.slot !== 'string' ||
    !['rest', 'xmlrpc', 'user-api'].includes(String(value.adapter))
  )
    throw new Error('saved-data-invalid')
  return {
    site: siteUrl(value.site),
    slot: value.slot,
    adapter: value.adapter as Connection['adapter'],
    ...(typeof value.blogId === 'string' ? { blogId: value.blogId } : {}),
  }
}
export function ledgerStore(scope: string): Store {
  return {
    async load() {
      const raw = await pluginData.get('publications', scope)
      if (raw === undefined || raw === null) return emptyLedger()
      const value = record(raw)
      if (
        value.version !== 1 ||
        !value.bindings ||
        Object.keys(record(value.bindings)).length > 500
      )
        throw new Error('saved-data-invalid')
      for (const binding of Object.values(record(value.bindings)).map(record)) {
        if (
          typeof binding.sourceId !== 'string' ||
          typeof binding.site !== 'string' ||
          typeof binding.marker !== 'string' ||
          !['ready', 'pending', 'unknown', 'deleted'].includes(String(binding.state))
        )
          throw new Error('saved-data-invalid')
      }
      return structuredClone(value) as unknown as Ledger
    },
    save: (value) => pluginData.set('publications', value, scope),
  }
}
export function currentScope(scope: string) {
  try {
    return publishing.list().workspaceScope === scope
  } catch {
    return false
  }
}
export function errorText(error: unknown) {
  const code = error instanceof Error ? error.message : String(error)
  const messages: Record<string, [string, string]> = {
    'invalid-site': [
      '请输入不含账号或查询参数的 HTTPS 站点地址。',
      'Enter an HTTPS site URL without credentials or query parameters.',
    ],
    'credential-unavailable': [
      '此设备尚未保存该站点的凭据，请到设置中连接。',
      'Connect this site in Settings on this device.',
    ],
    'credentials-changed': [
      '凭据已更改，请重新准备预览。',
      'Credentials changed. Prepare a new preview.',
    ],
    'site-not-authorized': [
      '当前账号无法访问所选站点或 Blog ID。',
      'The account cannot access this site or Blog ID.',
    ],
    'invalid-response': [
      '站点返回的内容无法核对。请检查连接及权限。',
      'The site response could not be verified. Check the connection and permissions.',
    ],
    'catalog-limit': [
      '站点内容超过本次完整核对上限，请缩小目标或在站点中核对文章 ID。',
      'The site exceeds the complete lookup limit. Verify the post ID on the site.',
    ],
    'remote-binding-mismatch': [
      '远端文章不属于当前材料，已停止操作。',
      'This remote post does not belong to this material. No changes were sent.',
    ],
    'remote-missing': [
      '绑定的远端文章已不存在，请先核对远端状态。',
      'The linked post is missing. Check its remote state first.',
    ],
    'remote-unconfirmed': [
      '尚未找到可确认的远端结果。请在站点核对；不要重复新建。',
      'No remote result could be confirmed. Check the site before creating another post.',
    ],
    'remote-changed': [
      '远端内容已变化，请重新预览后决定是否更新。',
      'The remote content changed. Review a new preview before updating it.',
    ],
    'reconcile-required': [
      '上次发布的结果尚未确认。先核对远端状态，再继续。',
      'The previous result is uncertain. Reconcile the remote state before continuing.',
    ],
    'preview-expired': ['预览已过期，请重新准备。', 'The preview expired. Prepare it again.'],
    'preview-changed': ['预览内容已变化，请重新准备。', 'The preview changed. Prepare it again.'],
    'workspace-changed': [
      '学习库已切换，旧操作已停止。',
      'The library changed. The previous operation stopped.',
    ],
    'saved-data-invalid': [
      '保存的发布记录无法读取，未覆盖原记录。',
      'Saved publishing records are unreadable and have not been overwritten.',
    ],
    'binding-limit': [
      '发布关联已达到 500 条上限，本次未发送。',
      'The 500-publication limit was reached. Nothing was sent.',
    ],
    'local-assets': [
      '此材料包含本地附件。远端连接器不会自动上传它们；请改用公开 HTTPS 图片地址，或使用静态站发布。',
      'This material includes local attachments. Use public HTTPS image URLs or static-site publishing.',
    ],
    'local-links': [
      '此材料包含尚未发布的内部链接。先发布被引用材料，或改为公开链接。',
      'This material contains unresolved internal links. Publish the referenced material first or use public URLs.',
    ],
    'authorization-invalid': [
      '授权结果无法验证，请复制完整的加密结果。',
      'Authorization could not be verified. Paste the complete encrypted result.',
    ],
    'authorization-expired': [
      '授权已过期或站点已更改，请重新开始。',
      'Authorization expired or the site changed. Start again.',
    ],
    'authorization-cancelled': ['授权已取消。', 'Authorization was cancelled.'],
    'no-selection': ['请先选择一份材料。', 'Choose a material first.'],
  }
  if (messages[code]) return t(...messages[code])
  if (code.includes('Abort') || code === 'http-cancelled')
    return t(
      '已停止等待。远端可能已收到请求，请核对状态。',
      'Stopped waiting. The site may have received the request; reconcile its state.',
    )
  if (/remote-http-(401|403)/.test(code))
    return t(
      '站点拒绝了凭据或操作权限，请检查连接。',
      'The site rejected the credentials or permissions. Check the connection.',
    )
  if (code === 'remote-http-409')
    return t(
      '远端正文发生冲突，请重新预览。',
      'The remote content conflicts with this change. Prepare a new preview.',
    )
  if (code === 'remote-xml-fault')
    return t(
      'XML-RPC 拒绝了请求，请检查账号、应用密码与站点权限。',
      'XML-RPC rejected the request. Check the account, application password and permissions.',
    )
  if (code.includes('desktop') || code === 'native-unavailable')
    return t('发布连接需要桌面版。', 'Publishing connections require the desktop app.')
  return t(
    '操作未完成，已保留当前输入与发布记录。请检查连接并核对远端状态。',
    'The operation did not complete. Your input and records are kept. Check the connection and reconcile the remote state.',
  )
}
