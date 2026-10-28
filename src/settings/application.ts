import { defineAsyncComponent, defineComponent, h, markRaw, type Component } from 'vue'
import { t, locale, setLocale } from '../i18n'
import { preferences, setPreference, preferenceError } from '../preferences'
import PluginPanel from '../components/PluginPanel.vue'
import type { SettingsCategory, SettingsContribution, SettingsEntry, SettingsField } from './types'

const AiCardSkill = defineAsyncComponent(() => import('../components/AiCardSkill.vue'))

export interface ApplicationSettingsOptions {
  scope: () => string
  platformSettings?: Component
  onConfigurePlugin: (id: string) => void
  detailsPlugin?: () => string | undefined
}

function category(id: string, title: string): SettingsCategory {
  return {
    id,
    get title() {
      return t(title)
    },
  }
}

/** Stable declarations read the existing preferences directly; callers cache them per scope. */
export function createApplicationSettings(options: ApplicationSettingsOptions): SettingsEntry[] {
  const scope = options.scope()
  const isCurrent = () => options.scope() === scope
  const entry = (contribution: SettingsContribution, standalone = false): SettingsEntry => ({
    ownerId: 'application',
    contribution,
    scope,
    isCurrent,
    standalone,
  })
  const entries = [
    entry({
      id: 'appearance',
      get title() {
        return t('界面')
      },
      category: [category('general', '通用'), category('appearance', '界面')],
      fields: [
        {
          key: 'locale',
          id: 'settings-language',
          type: 'select',
          get label() {
            return t('界面语言')
          },
          get modelValue() {
            return locale.value
          },
          options: [
            { value: 'en', label: 'English' },
            { value: 'zh-CN', label: '中文（简体）' },
          ],
          onChange(value) {
            if (isCurrent() && (value === 'en' || value === 'zh-CN')) setLocale(value)
          },
        },
      ],
    }),
    entry({
      id: 'notifications',
      get title() {
        return t('弹出通知')
      },
      get description() {
        return t('关闭弹出后，通知改为在页面内显示。警告和错误仍需手动关闭。')
      },
      get error() {
        return preferenceError.value ? t(preferenceError.value) : undefined
      },
      category: [category('general', '通用'), category('notifications', '通知')],
      fields: (
        [
          {
            key: 'popupInfo',
            label: '信息通知',
            description: '保存成功和一般提示，5 秒后自动关闭。',
          },
          { key: 'popupWarning', label: '警告通知', description: '需要留意的情况，手动关闭。' },
          { key: 'popupError', label: '错误通知', description: '操作失败和保存错误，手动关闭。' },
        ] as const
      ).map(({ key, label, description }): SettingsField => {
        return {
          key,
          type: 'switch' as const,
          get label() {
            return t(label)
          },
          get description() {
            return t(description)
          },
          get modelValue() {
            return preferences[key]
          },
          onChange(value) {
            if (isCurrent() && typeof value === 'boolean') setPreference(key, value)
          },
        }
      }),
    }),
  ]
  if (options.platformSettings) {
    const PlatformSettings = options.platformSettings
    for (const section of ['workspace', 'mcp'] as const) {
      entries.push(
        entry(
          {
            id: section,
            get title() {
              return t(section === 'workspace' ? '工作目录' : 'MCP 连接')
            },
            category:
              section === 'workspace'
                ? [category('workspace', '工作目录')]
                : [category('connections', '连接'), category('mcp', 'MCP 连接')],
            component: markRaw(
              defineComponent({
                name: section === 'workspace' ? 'WorkspaceSettingsEntry' : 'McpSettingsEntry',
                setup: () => () => h(PlatformSettings, { section }),
              }),
            ),
          },
          true,
        ),
      )
    }
  }
  entries.push(
    entry(
      {
        id: 'ai',
        get title() {
          return t('AI 制卡')
        },
        category: [category('tools', '工具'), category('ai', 'AI 制卡')],
        component: markRaw(AiCardSkill),
      },
      true,
    ),
    entry(
      {
        id: 'plugins',
        get title() {
          return t('插件')
        },
        category: [category('plugins', '插件')],
        component: markRaw(
          defineComponent({
            name: 'PluginManagementSettingsEntry',
            setup: () => () =>
              h(PluginPanel, {
                embedded: true,
                onConfigure: (id: string) => {
                  if (isCurrent()) options.onConfigurePlugin(id)
                },
                focusPlugin: options.detailsPlugin?.(),
              }),
          }),
        ),
      },
      true,
    ),
  )
  return entries
}
