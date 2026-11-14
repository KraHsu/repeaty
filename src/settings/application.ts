import { defineAsyncComponent, defineComponent, h, markRaw, type Component } from 'vue'
import { t, languagePreference, languageOptions, isLocale, setLanguagePreference } from '../i18n'
import { preferences, setPreference, preferenceError } from '../preferences'
import type { SettingsCategory, SettingsContribution, SettingsEntry, SettingsField } from './types'
import { createAppearanceSettings } from './appearance'

const AiCardSkill = defineAsyncComponent(() => import('../components/AiCardSkill.vue'))
const StudySettings = defineAsyncComponent(() => import('../components/StudySettings.vue'))
const SearchSynonymSettings = defineAsyncComponent(
  () => import('../components/SearchSynonymSettings.vue'),
)
const SourceMetadataSettings = defineAsyncComponent(
  () => import('../components/SourceMetadataSettings.vue'),
)
const MenuSettings = defineAsyncComponent(() => import('../components/MenuSettings.vue'))
const InputSettings = defineAsyncComponent(() => import('../components/InputSettings.vue'))
const LanguageSettings = defineAsyncComponent(() => import('../components/LanguageSettings.vue'))

export interface ApplicationSettingsOptions {
  scope: () => string
  platformSettings?: Component
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
      get error() {
        return preferenceError.value ? t(preferenceError.value) : undefined
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
            return languagePreference.value
          },
          get options() {
            return [{ value: 'system', label: t('跟随系统') }, ...languageOptions]
          },
          onChange(value) {
            if (isCurrent() && (value === 'system' || isLocale(value))) setLanguagePreference(value)
          },
        },
        {
          key: 'theme',
          id: 'settings-theme',
          type: 'select',
          get label() {
            return t('颜色模式')
          },
          get description() {
            return t('跟随系统时，外观会随设备的浅色或深色模式自动切换。')
          },
          get modelValue() {
            return preferences.theme
          },
          get options() {
            return [
              { value: 'system', label: t('跟随系统') },
              { value: 'light', label: t('浅色') },
              { value: 'dark', label: t('深色') },
            ]
          },
          onChange(value) {
            if (isCurrent() && (value === 'system' || value === 'light' || value === 'dark')) {
              setPreference('theme', value)
            }
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
  for (const [id, title, categoryId, categoryTitle, component] of [
    ['input', '快捷键与鼠标手势', 'input', '操作', InputSettings],
    ['language-packs', '语言与翻译', 'language', '语言', LanguageSettings],
    ['menus', '菜单与工具栏', 'input', '操作', MenuSettings],
    ['material-search', '材料搜索', 'search', '搜索', SearchSynonymSettings],
    ['material-reading', '材料属性', 'reading', '阅读', SourceMetadataSettings],
  ] as const) {
    entries.push(
      entry(
        {
          id,
          get title() {
            return t(title)
          },
          category: [category('general', '通用'), category(categoryId, categoryTitle)],
          component: markRaw(
            defineComponent({
              name:
                id === 'material-search'
                  ? 'MaterialSearchSettingsEntry'
                  : 'MaterialReadingSettingsEntry',
              setup: () => () => (isCurrent() ? h(component, { isCurrent }) : null),
            }),
          ),
        },
        true,
      ),
    )
  }
  for (const [section, title] of [
    ['review', '复习'],
    ['queue', '队列'],
    ['reading', '阅读'],
  ] as const) {
    entries.push(
      entry(
        {
          id: `study-${section}`,
          get title() {
            return t(title)
          },
          category: [category('study', '学习'), category(section, title)],
          component: markRaw(
            defineComponent({
              name: `StudySettings${section}`,
              setup: () => () => (isCurrent() ? h(StudySettings, { section, isCurrent }) : null),
            }),
          ),
        },
        true,
      ),
    )
  }
  if (options.platformSettings) {
    const PlatformSettings = options.platformSettings
    for (const section of ['workspace', 'mcp', 'capture', 'experience', 'sync'] as const) {
      entries.push(
        entry(
          {
            id: section,
            get title() {
              return section === 'sync'
                ? t('设备同步')
                : section === 'experience'
                  ? t('桌面')
                  : section === 'capture'
                    ? '快捷收集'
                    : t(section === 'workspace' ? '工作目录' : 'MCP 连接')
            },
            category:
              section === 'experience'
                ? [category('general', '通用'), category('desktop', '桌面')]
                : section === 'workspace'
                  ? [category('workspace', '工作目录')]
                  : [
                      category('connections', '连接'),
                      {
                        id: section,
                        title:
                          section === 'sync'
                            ? t('设备同步')
                            : section === 'capture'
                              ? '快捷收集'
                              : t('MCP 连接'),
                      },
                    ],
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
  )
  entries.push(...createAppearanceSettings(options.scope))
  return entries
}
