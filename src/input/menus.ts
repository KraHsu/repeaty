import {
  computed,
  inject,
  provide,
  ref,
  watch,
  onScopeDispose,
  getCurrentScope,
  type InjectionKey,
  type Ref,
} from 'vue'
import { persistSetting, readSetting } from '../settings-store'

export type MenuSurface =
  'reading-toolbar' | 'reading-selection' | 'reading-context' | 'review-menu'
export interface MenuAction {
  id: string
  title: string
  disabled?: boolean
  essential?: boolean
  run: () => void | Promise<unknown>
}
export const readingActionDefinitions = [
  ['material.copy', '复制选中文字'],
  ['material.excerpt', '保存为摘录'],
  ['material.card', '用摘录制卡'],
  ['material.cloze', '制作挖空卡'],
  ['material.annotation', '添加批注'],
  ['material.share', '通过 MCP 制卡'],
  ['material.preview', '切换阅读预览'],
  ['material.export', '导出原件'],
] as const
export interface MenuPreferences {
  version: 1
  selectionEnabled: boolean
  selectionOpacity: number
  surfaces: Record<MenuSurface, { order: string[]; hidden: string[] }>
}
export const MENU_SETTINGS_KEY = 'repeaty.menus.v1'
export function defaultMenus(): MenuPreferences {
  return {
    version: 1,
    selectionEnabled: true,
    selectionOpacity: 100,
    surfaces: {
      'reading-toolbar': {
        order: [],
        hidden: [
          'material.copy',
          'material.excerpt',
          'material.card',
          'material.cloze',
          'material.annotation',
          'material.share',
        ],
      },
      'reading-selection': { order: [], hidden: ['material.preview', 'material.export'] },
      'reading-context': { order: [], hidden: [] },
      'review-menu': { order: [], hidden: [] },
    },
  }
}
function ids(value: unknown): string[] {
  return Array.isArray(value)
    ? [
        ...new Set(
          value.filter(
            (id): id is string => typeof id === 'string' && /^[a-zA-Z0-9:._-]{1,220}$/.test(id),
          ),
        ),
      ].slice(0, 300)
    : []
}
export function normalizeMenus(value: unknown): MenuPreferences {
  const defaults = defaultMenus()
  if (!value || typeof value !== 'object' || (value as MenuPreferences).version !== 1)
    return defaults
  const raw = value as Partial<MenuPreferences>
  defaults.selectionEnabled = raw.selectionEnabled !== false
  if (Number.isFinite(raw.selectionOpacity))
    defaults.selectionOpacity = Math.max(30, Math.min(100, Number(raw.selectionOpacity)))
  for (const surface of Object.keys(defaults.surfaces) as MenuSurface[]) {
    const config = raw.surfaces?.[surface]
    if (config && typeof config === 'object')
      defaults.surfaces[surface] = { order: ids(config.order), hidden: ids(config.hidden) }
  }
  return defaults
}
export function arrangeMenu<T extends { id: string; essential?: boolean }>(
  items: readonly T[],
  config: { order: string[]; hidden: string[] },
): T[] {
  const ranks = new Map(config.order.map((id, rank) => [id, rank]))
  return items
    .filter((item) => item.essential || !config.hidden.includes(item.id))
    .map((item, index) => ({ item, index }))
    .sort(
      (a, b) =>
        (ranks.get(a.item.id) ?? config.order.length + a.index) -
        (ranks.get(b.item.id) ?? config.order.length + b.index),
    )
    .map(({ item }) => item)
}
export function createMenuPreferences(scope: Ref<string>) {
  const value = ref(defaultMenus()),
    error = ref(''),
    saving = ref(false)
  let generation = 0,
    alive = true
  if (getCurrentScope())
    onScopeDispose(() => {
      alive = false
      generation++
    })
  watch(
    scope,
    () => {
      generation++
      saving.value = false
      error.value = ''
      try {
        value.value = normalizeMenus(JSON.parse(readSetting(MENU_SETTINGS_KEY) ?? 'null'))
      } catch {
        value.value = defaultMenus()
      }
    },
    { immediate: true, flush: 'sync' },
  )
  async function save(next: MenuPreferences) {
    if (!alive || saving.value) return false
    const epoch = generation
    saving.value = true
    error.value = ''
    const normalized = normalizeMenus(next)
    try {
      await persistSetting(MENU_SETTINGS_KEY, JSON.stringify(normalized))
      if (epoch !== generation) return false
      value.value = normalized
      return true
    } catch {
      if (epoch === generation) error.value = '菜单设置未保存，请重试。'
      return false
    } finally {
      if (epoch === generation) saving.value = false
    }
  }
  return { value: computed(() => value.value), error, saving, save }
}
export type MenuPreferencesController = ReturnType<typeof createMenuPreferences>
const key: InjectionKey<MenuPreferencesController> = Symbol('menu-preferences')
export function provideMenuPreferences(scope: Ref<string>) {
  const controller = createMenuPreferences(scope)
  provide(key, controller)
  return controller
}
export function useMenuPreferences() {
  return inject(key, undefined)
}
