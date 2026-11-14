import type { Source } from './source-data'

export function materialLocked(source: Source, sources: readonly Source[]) {
  const sequence = source.studySequence
  return (
    !!sequence &&
    sequence.mode === 'sequential' &&
    sources.some(
      (other) =>
        other.studySequence?.groupId === sequence.groupId &&
        other.studySequence.index < sequence.index &&
        !other.studySequence.completed,
    )
  )
}
export function validateMaterialSequences(
  sources: readonly Source[],
  problem: (message: string) => void,
) {
  const groups = new Map<string, Source[]>()
  for (const source of sources) {
    if (!source.studySequence) continue
    const group = groups.get(source.studySequence.groupId) ?? []
    group.push(source)
    groups.set(source.studySequence.groupId, group)
  }
  for (const [id, entries] of groups) {
    const root = sources.find((source) => source.id === id)
    if (
      !root?.document?.container ||
      root.studySequence ||
      new Set(entries.map((source) => source.studySequence!.index)).size !== entries.length ||
      new Set(entries.map((source) => source.studySequence!.mode)).size !== 1
    )
      problem('章节分组、顺序或阅读模式不一致')
  }
}
