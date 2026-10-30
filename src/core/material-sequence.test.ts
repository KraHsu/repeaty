import { expect, it } from 'vitest'
import { prepareSource, removeSource } from './sources'
import { fixture, now } from './test-fixtures'
import { queuedSources, sourceQueueState, arrangeSource } from './source-queue'
import { materialLocked, validateMaterialSequences } from './material-sequence'
import { type Source } from './source-data'

function book() {
  const root = prepareSource(
    { title: 'Book', format: 'plain', url: '', content: 'Contents' },
    now,
  ).source
  root.document = {
    schemaVersion: 1,
    format: 'epub',
    providerId: 'document-reader',
    readerId: 'documents',
    originalMediaId: 'book',
    container: true,
  }
  const sources: Source[] = [
    root,
    ...[0, 1].map((index) => ({
      ...prepareSource(
        { title: `Chapter ${index}`, format: 'plain', url: '', content: 'Read' },
        now,
      ).source,
      parentSourceId: root.id,
      studySequence: { groupId: root.id, index, mode: 'sequential' as const, completed: false },
    })),
  ]
  return sources
}
it('keeps containers and locked chapters out of reading queues and releases the next chapter on completion', () => {
  const sources = book(),
    today = '2026-10-30'
  expect(queuedSources(sources, 'ready', today).map((entry) => entry.id)).toEqual([sources[1]!.id])
  expect(materialLocked(sources[2]!, sources)).toBe(true)
  const library = { ...fixture(), sources }
  expect(() =>
    arrangeSource(
      library,
      sources[2]!.id,
      sources[2]!.mediaId,
      { type: 'read', intervalDays: 1, date: '2026-10-31' },
      now,
    ),
  ).toThrow('请先完成前面的章节')
  sources[1]!.studySequence!.completed = true
  expect(sourceQueueState(sources[1]!, today, sources)).toBe('archived')
  expect(queuedSources(sources, 'ready', today).map((entry) => entry.id)).toEqual([sources[2]!.id])
  sources.forEach((source) => {
    if (source.studySequence) {
      source.studySequence.mode = 'free'
      source.studySequence.completed = false
    }
  })
  expect(queuedSources(sources, 'ready', today)).toHaveLength(2)
})
it('keeps chapter sequence independent of folders, rejects inconsistent groups, and detaches a deleted book', () => {
  const sources = book(),
    issues: string[] = []
  sources[2]!.parentSourceId = undefined
  validateMaterialSequences(sources, (issue) => issues.push(issue))
  expect(issues).toEqual([])
  sources[2]!.studySequence!.index = 0
  validateMaterialSequences(sources, (issue) => issues.push(issue))
  expect(issues).toHaveLength(1)
  const next = removeSource({ ...fixture(), sources }, sources[0]!.id)
  expect(next.sources.every((source) => !source.studySequence && !source.parentSourceId)).toBe(true)
})
