import { MAX_SOURCE_DEPTH, type Source, type SourceExcerpt } from './source-data'

export function validateSourceHierarchy(sources: Source[], problem: (message: string) => void) {
  const entries = new Map(sources.map((source) => [source.id, source]))
  for (const source of sources) {
    const seen = new Set<string>([source.id])
    let current = source,
      depth = 0
    while (current.origin) {
      const parent = entries.get(current.origin.sourceId)
      if (!parent || seen.has(parent.id)) {
        problem('摘录出处不能形成循环或引用缺失材料。')
        break
      }
      if (++depth > MAX_SOURCE_DEPTH) {
        problem('摘录层级不能超过 32 层。')
        break
      }
      seen.add(parent.id)
      current = parent
    }
  }
}

/** Each anchor addresses its immediate parent's immutable text. */
export function sourceContextPath(sources: Source[], source: Source, excerpt?: SourceExcerpt) {
  const entries = new Map(sources.map((source) => [source.id, source]))
  const path: { source: Source; excerpt?: SourceExcerpt }[] = [{ source, excerpt }]
  const seen = new Set([source.id])
  let current = source,
    selection = excerpt
  while (current.origin && path.length <= MAX_SOURCE_DEPTH) {
    const parent = entries.get(current.origin.sourceId)
    if (!parent || seen.has(parent.id)) break
    if (selection)
      selection = {
        ...selection,
        sourceId: parent.id,
        start: current.origin.start + selection.start,
        end: current.origin.start + selection.end,
      }
    path.push({ source: parent, excerpt: selection })
    seen.add(parent.id)
    current = parent
  }
  return path
}
