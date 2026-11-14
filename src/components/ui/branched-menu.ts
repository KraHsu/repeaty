// Repeaty's settings tree model. SPDX-License-Identifier: AGPL-3.0-only
import type { ComputedRef, InjectionKey, Ref } from 'vue'
import type { SettingsCategoryNode } from '../../settings/types'
export interface BranchedMenuRow {
  node: SettingsCategoryNode
  parent?: string
  root: string
  depth: number
  position: number
  count: number
}
export function flattenBranchedMenu(items: readonly SettingsCategoryNode[]): BranchedMenuRow[] {
  const result: BranchedMenuRow[] = [],
    seen = new Set<string>()
  const pending = items
    .map(
      (node, index) =>
        ({
          node,
          root: node.key,
          depth: 1,
          position: index + 1,
          count: items.length,
        }) as BranchedMenuRow,
    )
    .reverse()
  while (pending.length) {
    const row = pending.pop()!
    if (seen.has(row.node.key) || row.depth > 4) continue
    seen.add(row.node.key)
    result.push(row)
    for (let index = row.node.children.length - 1; index >= 0; index--)
      pending.push({
        node: row.node.children[index]!,
        parent: row.node.key,
        root: row.root,
        depth: row.depth + 1,
        position: index + 1,
        count: row.node.children.length,
      })
  }
  return result
}
export function menuAncestors(rows: readonly BranchedMenuRow[], key: string): string[] {
  const parents = new Map(rows.map((row) => [row.node.key, row.parent]))
  const path: string[] = []
  for (
    let parent = parents.get(key);
    parent && !path.includes(parent);
    parent = parents.get(parent)
  )
    path.push(parent)
  return path.reverse()
}
export function visibleMenuRows(rows: readonly BranchedMenuRow[], expanded: ReadonlySet<string>) {
  const visible = new Set<string>()
  return rows.filter((row) => {
    if (row.parent && (!visible.has(row.parent) || !expanded.has(row.parent))) return false
    visible.add(row.node.key)
    return true
  })
}
export interface BranchedMenuContext {
  active: ComputedRef<string>
  focused: Ref<string>
  expanded: Ref<Set<string>>
  rows: ComputedRef<BranchedMenuRow[]>
  selectedPath: ComputedRef<ReadonlySet<string>>
  idPrefix: string
  controls: string
  registerRow(key: string, value: unknown): void
  registerGroup(key: string, value: unknown): void
  select(key: string): void
  toggle(key: string, focusRow?: boolean): void
}
export const branchedMenuKey: InjectionKey<BranchedMenuContext> = Symbol('repeaty-settings-tree')
