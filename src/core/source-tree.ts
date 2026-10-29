import { MAX_SOURCE_DEPTH, referencedSource, type Source, type SourceExcerpt } from './source-data'

export function validateSourceHierarchy(sources: Source[], problem: (message: string) => void) {
  const entries = new Map(sources.map((source) => [source.id, source]))
  const depths = new Map<string, number>()
  const path = new Set<string>()
  function depth(source: Source): number {
    const known = depths.get(source.id)
    if (known !== undefined) return known
    if (path.has(source.id)) {
      problem('摘录出处不能形成循环或引用缺失材料。')
      return MAX_SOURCE_DEPTH + 1
    }
    if (path.size > MAX_SOURCE_DEPTH) {
      problem('摘录层级不能超过 32 层。')
      return MAX_SOURCE_DEPTH + 1
    }
    path.add(source.id)
    let result = 0
    for (const id of new Set([source.origin?.sourceId, source.parentSourceId])) {
      if (!id) continue
      const parent = entries.get(id)
      if (!parent) problem('摘录出处不能形成循环或引用缺失材料。')
      else result = Math.max(result, 1 + depth(parent))
    }
    path.delete(source.id)
    depths.set(source.id, result)
    return result
  }
  for (const source of sources)
    if (depth(source) > MAX_SOURCE_DEPTH) problem('摘录层级不能超过 32 层。')
}

/** Each anchor addresses its immediate parent's immutable text. */
export function sourceContextPath(sources: Source[], source: Source, excerpt?: SourceExcerpt) {
  const entries = new Map(sources.map((source) => [source.id, source]))
  const initial = excerpt ? referencedSource(source, excerpt) : source
  if (!initial) return [{ source, excerpt }]
  const path: { source: Source; excerpt?: SourceExcerpt }[] = [{ source: initial, excerpt }]
  const seen = new Set([source.id])
  let current = initial,
    selection = excerpt
  while (current.origin && path.length <= MAX_SOURCE_DEPTH) {
    const entry = entries.get(current.origin.sourceId)
    const parent = entry && referencedSource(entry, current.origin)
    if (!parent || seen.has(parent.id)) break
    if (current.derived) selection = undefined
    if (selection)
      selection = {
        ...selection,
        sourceId: parent.id,
        mediaId: parent.mediaId,
        start: current.origin.start + selection.start,
        end: current.origin.start + selection.end,
        locator: undefined,
      }
    path.push({ source: parent, excerpt: selection })
    seen.add(parent.id)
    current = parent
  }
  return path
}
