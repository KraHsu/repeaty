import { readSetting, persistSetting } from './settings-store'
export const SOURCE_FIELDS_KEY = 'repeaty.material-fields.v1'
export const SOURCE_FIELDS_EVENT = 'repeaty-material-fields-changed'
export function sourceMetadataFields() {
  const value = readSetting(SOURCE_FIELDS_KEY) ?? ''
  return [
    ...new Set(
      value
        .split(/[,，\n]/)
        .map((key) => key.trim())
        .filter(Boolean),
    ),
  ].slice(0, 30)
}
export async function saveSourceMetadataFields(
  value: string,
  isCurrent: () => boolean = () => true,
) {
  const keys = [
    ...new Set(
      value
        .split(/[,，\n]/)
        .map((key) => key.trim())
        .filter(Boolean),
    ),
  ]
  if (keys.length > 30 || keys.some((key) => key.length > 100))
    throw new Error('最多显示 30 个属性，每个名称不超过 100 个字符。')
  if (!isCurrent()) return
  await persistSetting(SOURCE_FIELDS_KEY, keys.join(', '))
  if (isCurrent()) window.dispatchEvent(new Event(SOURCE_FIELDS_EVENT))
}
