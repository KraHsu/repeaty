import { t } from './i18n'
import { defineAsyncComponent } from 'vue'
import {
  registerSettings,
  type PluginSettingsContribution,
  type ReviewPanelPlugin,
} from '@repeaty/plugin-api'
import { preferences, setPreference, preferenceError, initializePreferences } from './preferences'

export default function activate(): ReviewPanelPlugin {
  initializePreferences()
  registerSettings({
    id: 'display',
    category: [
      {
        id: 'study',
        get title() {
          return t('学习')
        },
      },
      {
        id: 'review',
        get title() {
          return t('复习')
        },
      },
    ],
    get title() {
      return t('答题历史')
    },
    get description() {
      return t('调整历史记录的显示方式。')
    },
    get error() {
      return preferenceError.value ? t(preferenceError.value) : undefined
    },
    fields: [
      {
        key: 'historyLength',
        type: 'number',
        min: 1,
        max: 50,
        step: 1,
        commit: 'change',
        get label() {
          return t('显示条数')
        },
        get description() {
          return t('显示当前卡片最近 1–50 次评分。')
        },
        get modelValue() {
          return preferences.historyLength
        },
        onChange(value) {
          if (typeof value === 'number') setPreference('historyLength', value)
        },
      },
      {
        key: 'historyAfterReveal',
        type: 'switch',
        get label() {
          return t('翻面后才显示历史')
        },
        get description() {
          return t('开启后，显示答案时再展示历史记录。')
        },
        get modelValue() {
          return preferences.historyAfterReveal
        },
        onChange(value) {
          if (typeof value === 'boolean') setPreference('historyAfterReveal', value)
        },
      },
    ],
  } satisfies PluginSettingsContribution)
  return {
    id: 'review-history',
    kind: 'frontend',
    get label() {
      return t('答题历史')
    },
    version: 1,
    get description() {
      return t('复习时查看当前卡片的评分记录。')
    },
    reviewPanel: defineAsyncComponent(() => import('./Panel.vue')),
  } satisfies ReviewPanelPlugin
}
