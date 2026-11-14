import { reactive, ref } from 'vue'
import { readSetting, writeSetting } from '@repeaty/plugin-api'
import type { CleanupOptions, CleanupRule } from './cleanup'

export function createCleanupSettings() {
  const options = reactive<CleanupOptions>({
    trimTrailing: true,
    collapseBlankLines: true,
    normalizeIndent: true,
    rules: [],
  })
  const error = ref('')
  try {
    const value = JSON.parse(readSetting('cleanup-options') ?? 'null')
    if (value && typeof value === 'object') {
      for (const key of ['trimTrailing', 'collapseBlankLines', 'normalizeIndent'] as const)
        if (typeof value[key] === 'boolean') options[key] = value[key]
      if (Array.isArray(value.rules) && value.rules.length <= 32)
        options.rules = value.rules.filter(
          (rule: CleanupRule) =>
            rule &&
            ['literal', 'regex'].includes(rule.kind) &&
            typeof rule.find === 'string' &&
            typeof rule.replace === 'string',
        )
    }
  } catch {
    error.value = '保存的规则无法读取，请重新配置。'
  }
  const save = () =>
    writeSetting('cleanup-options', JSON.stringify(options), () => {
      error.value = '保存规则失败。'
    })
  return { options, error, save }
}
export type CleanupSettings = ReturnType<typeof createCleanupSettings>
