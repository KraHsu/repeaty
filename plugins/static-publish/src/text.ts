import { locale } from '@repeaty/plugin-api'
export const t = (zh: string, en: string) => (locale.value === 'en' ? en : zh)
export function message(error: unknown) {
  if (error instanceof DOMException && error.name === 'AbortError')
    return t(
      '已停止。上次生成的站点和发布记录仍保留。',
      'Stopped. The previous site and publishing records are kept.',
    )
  const code = error instanceof Error ? error.message : String(error)
  if (/^publishing-(library-changed|preview-expired|source-missing)$/u.test(code))
    return t(
      '材料已变化或预览过期，请刷新材料列表并重新生成。',
      'Content changed or the preview expired. Refresh the materials and generate again.',
    )
  if (/^publishing-(source-private|private-field)$/u.test(code))
    return t(
      '所选材料或字段包含草稿、私密信息。请取消选择私密材料，并检查公开字段。',
      'A selected material or field is private or a draft. Deselect private materials and check the public fields.',
    )
  if (/^publishing-(field-type|frontmatter-invalid)$/u.test(code))
    return t(
      '材料属性格式无效。公开字段仅支持文字、数字、布尔值或文字列表。',
      'Invalid material properties. Public fields support text, numbers, booleans or text lists.',
    )
  if (/^publishing-.*limit$/u.test(code))
    return t(
      '材料或附件超过发布限制，请减少选择后重新生成。',
      'The publication limit was exceeded. Select fewer materials and generate again.',
    )
  if (code.startsWith('publishing-asset-'))
    return t(
      '材料附件缺失、不可公开或类型不受支持，请检查材料引用。',
      'A referenced asset is missing, unavailable or unsupported. Check the material references.',
    )
  return (
    (
      {
        'cloudflare-auth-failed': t(
          'Cloudflare 凭据无效或权限不足，请检查连接设置。',
          'Check the Cloudflare credential and its permissions.',
        ),
        'cloudflare-network-unknown': t(
          '连接中断。请先核对远端状态，避免重复部署。',
          'Connection interrupted. Check the remote status before another deployment.',
        ),
        'cloudflare-project-missing': t(
          '目标项目不存在，请在设置中检查或创建项目。',
          'The target project is missing. Check or create it in Settings.',
        ),
        'cloudflare-invalid-target': t(
          '请先在设置中填写有效的 Cloudflare 账号、项目和分支。',
          'Configure a valid Cloudflare account, project and branch in Settings.',
        ),
        'cloudflare-credentials-changed': t(
          '设备凭据已变化，请重新检查连接。',
          'The device credential changed. Check the connection again.',
        ),
        'cloudflare-pending': t(
          '上次部署结果尚未确定，请先核对状态。',
          'The previous deployment is unresolved. Check its status first.',
        ),
        'desktop-required': t(
          '联网发布需要桌面版；此处仍可生成、预览和导出。',
          'Online publishing requires the desktop app. Generation, preview and export remain available here.',
        ),
        'permission-denied': t(
          '尚未授予连接权限，请检查插件与设备设置。',
          'Connection permission is missing. Check plugin and device settings.',
        ),
        'publication-stale': t(
          '材料已变化或预览过期，请重新生成后再导出或发布。',
          'Content changed or the preview expired. Generate again before exporting or publishing.',
        ),
      } as Record<string, string>
    )[code] ??
    (code.startsWith('cloudflare-')
      ? t(
          'Cloudflare 操作未完成，请核对目标和发布状态。',
          'The Cloudflare operation did not complete. Check the target and deployment status.',
        )
      : code)
  )
}
