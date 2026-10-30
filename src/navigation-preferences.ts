import { reactive, readonly, ref } from 'vue'
import { z } from 'zod'
import { readSetting, writeSetting } from './settings-store'

export const NAVIGATION_KEY = 'repeaty.navigation.v1'
export const navigationIcons = [
  'default',
  'layers',
  'files',
  'book',
  'folder',
  'history',
  'database',
  'puzzle',
  'settings',
  'star',
  'chart',
  'grid',
] as const
const id = z.string().min(1).max(220)
const schema = z.object({
  order: z.array(id).max(200).catch([]),
  hidden: z.array(id).max(200).catch([]),
  icons: z.record(id, z.enum(navigationIcons)).catch({}),
  labels: z.enum(['auto', 'always']).catch('auto'),
  density: z.enum(['comfortable', 'compact']).catch('comfortable'),
})
export type NavigationPreferences = z.infer<typeof schema>
const state = reactive(schema.parse({}))
export const navigationPreferences = readonly(state)
export const navigationError = ref('')
let generation = 0
export function restoreNavigationPreferences() {
  generation++
  try {
    Object.assign(state, schema.parse(JSON.parse(readSetting(NAVIGATION_KEY) ?? '{}')))
  } catch {
    Object.assign(state, schema.parse({}))
  }
  state.hidden = state.hidden.filter((id) => id !== 'settings' && id !== 'help')
  navigationError.value = ''
}
export function setNavigationPreference<K extends keyof NavigationPreferences>(
  key: K,
  value: NavigationPreferences[K],
) {
  const parsed = schema.safeParse({ ...state, [key]: value })
  if (!parsed.success || JSON.stringify(parsed.data[key]) !== JSON.stringify(value)) return false
  parsed.data.hidden = parsed.data.hidden.filter((key) => key !== 'settings' && key !== 'help')
  Object.assign(state, parsed.data)
  navigationError.value = ''
  const current = generation
  try {
    writeSetting(NAVIGATION_KEY, JSON.stringify(state), () => {
      if (current !== generation) return
      navigationError.value = '设置已生效，但未能保存；下次打开时可能恢复默认设置。'
    })
  } catch {
    navigationError.value = '设置已生效，但未能保存；下次打开时可能恢复默认设置。'
  }
  return true
}
export function resetNavigationPreferences() {
  Object.assign(state, schema.parse({}))
  setNavigationPreference('order', [])
}
/** Missing/disabled plugins stay in storage, but cannot create an executable entry. */
export function orderedNavigation<T extends { id: string }>(
  items: T[],
  order: readonly string[] = state.order,
): T[] {
  const ranking = new Map(order.map((id, index) => [id, index]))
  return [...items].sort(
    (a, b) =>
      (ranking.get(a.id) ?? order.length + items.indexOf(a)) -
      (ranking.get(b.id) ?? order.length + items.indexOf(b)),
  )
}
