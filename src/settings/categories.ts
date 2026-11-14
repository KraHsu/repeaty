import type { SettingsCategory, SettingsCategoryNode, SettingsEntry } from './types'
export type { SettingsCategory, SettingsCategoryNode, SettingsEntry } from './types'

const generalCategory: readonly SettingsCategory[] = [{ id: 'general', title: '通用' }]

export function validateSettingsCategoryPath(path: readonly SettingsCategory[]) {
  if (!Array.isArray(path) || path.length === 0 || path.length > 4)
    throw new Error('设置分类路径无效。')
  const ids = new Set<string>()
  for (const segment of path as readonly SettingsCategory[]) {
    if (
      !segment ||
      typeof segment !== 'object' ||
      typeof segment.id !== 'string' ||
      !/^[a-z][a-z0-9-]{0,63}$/.test(segment.id) ||
      ids.has(segment.id) ||
      typeof segment.title !== 'string' ||
      !segment.title.trim()
    )
      throw new Error('设置分类路径无效。')
    ids.add(segment.id)
  }
}

/** Merge subject paths across application and plugin owners, preserving first-seen order. */
export function buildSettingsCategories(
  entries: readonly SettingsEntry[],
  defaultCategoryPath: readonly SettingsCategory[] = generalCategory,
  canonicalTitles: Readonly<Record<string, string>> = {},
): SettingsCategoryNode[] {
  validateSettingsCategoryPath(defaultCategoryPath)
  const roots: SettingsCategoryNode[] = []
  const nodes = new Map<string, SettingsCategoryNode>()
  for (const entry of entries) {
    const path = entry.contribution.category ?? defaultCategoryPath
    validateSettingsCategoryPath(path)
    let siblings = roots
    let key = ''
    let current: SettingsCategoryNode | undefined
    for (const segment of path) {
      key = key ? `${key}.${segment.id}` : segment.id
      const fullKey = key
      const canonical = Object.hasOwn(canonicalTitles, fullKey)
      if (
        canonical &&
        (typeof canonicalTitles[fullKey] !== 'string' || !canonicalTitles[fullKey]!.trim())
      )
        throw new Error('设置分类标题无效。')
      current = nodes.get(fullKey)
      if (!current) {
        current = {
          key: fullKey,
          get title() {
            return canonical ? canonicalTitles[fullKey]! : segment.title
          },
          children: [],
          entries: [],
        }
        nodes.set(fullKey, current)
        siblings.push(current)
      }
      siblings = current.children
    }
    current!.entries.push(entry)
  }
  return roots
}

/** Preorder traversal for views which display a category and all of its descendants. */
export function collectSettingsCategoryEntries(node: SettingsCategoryNode): SettingsEntry[] {
  return [...node.entries, ...node.children.flatMap(collectSettingsCategoryEntries)]
}
