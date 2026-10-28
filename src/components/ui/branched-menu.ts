// Branch geometry adapted from React Bits / Vue Bits Branched Menu.
// Copyright (c) 2025–2026 David Haz. See public/licenses/branched-menu.txt.
import type { ComputedRef, InjectionKey, Ref, ShallowRef } from 'vue'
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
  const rows: BranchedMenuRow[] = []
  const seen = new Set<string>()
  function visit(
    nodes: readonly SettingsCategoryNode[],
    depth: number,
    parent?: string,
    root?: string,
  ) {
    if (depth > 4) return
    nodes.forEach((node, index) => {
      if (seen.has(node.key)) return
      seen.add(node.key)
      rows.push({
        node,
        parent,
        root: root ?? node.key,
        depth,
        position: index + 1,
        count: nodes.length,
      })
      visit(node.children, depth + 1, node.key, root ?? node.key)
    })
  }
  visit(items, 1)
  return rows
}

export function menuAncestors(rows: readonly BranchedMenuRow[], key: string): string[] {
  const result: string[] = []
  let row = rows.find((entry) => entry.node.key === key)
  while (row?.parent) {
    result.unshift(row.parent)
    row = rows.find((entry) => entry.node.key === row!.parent)
  }
  return result
}

export function visibleMenuRows(rows: readonly BranchedMenuRow[], expanded: ReadonlySet<string>) {
  return rows.filter((row) => menuAncestors(rows, row.node.key).every((key) => expanded.has(key)))
}

export interface BranchGeometry {
  trunk: number
  end: number
  radius: number
  height: number
  centers: number[]
}

export function fallbackBranchGeometry(count: number, rem = 16): BranchGeometry {
  const row = 2.75 * rem
  return {
    trunk: 0.875 * rem,
    end: 2.5 * rem - 0.5 * rem,
    radius: Math.min(0.625 * rem, row / 2 - 2),
    height: 0.75 * rem + count * row,
    centers: Array.from({ length: count }, (_, index) => 0.375 * rem + index * row + row / 2),
  }
}

export function branchPath(geometry: BranchGeometry, index: number, reach = false) {
  const y = geometry.centers[index] ?? 0
  const { trunk, radius, end } = geometry
  return `${reach ? `M ${trunk} 0 V` : `M ${trunk}`} ${y - radius} A ${radius} ${radius} 0 0 0 ${trunk + radius} ${y} H ${end}`
}

export function branchLength(geometry: BranchGeometry, index: number) {
  const y = geometry.centers[index] ?? 0
  return (
    y -
    geometry.radius +
    (Math.PI * geometry.radius) / 2 +
    geometry.end -
    geometry.trunk -
    geometry.radius
  )
}

export interface BranchedMenuContext {
  active: ComputedRef<string>
  selectedPath: ComputedRef<ReadonlySet<string>>
  focused: Ref<string>
  expanded: Ref<Set<string>>
  rows: ComputedRef<BranchedMenuRow[]>
  geometry: ShallowRef<Map<string, BranchGeometry>>
  idPrefix: string
  controls: string
  registerRow(key: string, element: unknown): void
  registerGroup(key: string, element: unknown): void
  select(key: string): void
  toggle(key: string, focusRow?: boolean): void
}

export const branchedMenuKey: InjectionKey<BranchedMenuContext> = Symbol('branched-menu')
