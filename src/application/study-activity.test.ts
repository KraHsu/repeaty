import { expect, it } from 'vitest'
import { createStudyActivityRecorder, type ActivitySample } from './study-activity'
import { studyActivitySchema } from '../core/study-data'

const start = new Date('2026-10-30T06:00:00Z').getTime()
function sample(ms: number, values: Partial<ActivitySample> = {}): ActivitySample {
  return {
    scope: 'a',
    wall: new Date(start + ms),
    monotonic: ms,
    foreground: true,
    kind: 'review',
    dayStartHour: 0,
    ...values,
  }
}
it('counts only active foreground intervals, capping idle and ignoring sleep', () => {
  const recorder = createStudyActivityRecorder('test')
  recorder.sample(sample(0), true)
  for (let ms = 1000; ms <= 70_000; ms += 1000) recorder.sample(sample(ms))
  expect(recorder.pending()[0]!.activeMs).toBe(60_000)
  recorder.sample(sample(80_000), true)
  recorder.sample(sample(81_000, { foreground: false }))
  recorder.sample(sample(82_000))
  recorder.sample(sample(83_000))
  expect(recorder.pending()[0]!.activeMs).toBe(62_000)
})
it('a late save acknowledgment cannot drop activity accumulated during the save', () => {
  const recorder = createStudyActivityRecorder('test')
  recorder.sample(sample(0))
  recorder.sample(sample(1000))
  const saved = recorder.pending()
  recorder.sample(sample(2000))
  recorder.acknowledge(saved)
  expect(recorder.pending()[0]!.activeMs).toBe(2000)
  recorder.acknowledge(recorder.pending())
  expect(recorder.pending()).toEqual([])
})
it('separates kinds and workspaces, and does not count clock jumps', () => {
  const recorder = createStudyActivityRecorder('test')
  recorder.sample(sample(0))
  recorder.sample(sample(1000, { kind: 'reading' }))
  recorder.sample(sample(2000))
  expect(recorder.pending().map((row) => [row.kind, row.activeMs])).toEqual([
    ['review', 1000],
    ['reading', 1000],
  ])
  recorder.sample(sample(3000, { wall: new Date(start - 1000) }))
  expect(recorder.pending().reduce((sum, row) => sum + row.activeMs, 0)).toBe(2000)
  recorder.sample(sample(4000, { scope: 'b' }))
  recorder.sample(sample(5000, { scope: 'b' }))
  expect(recorder.pending()).toHaveLength(1)
  expect(recorder.pending()[0]!.activeMs).toBe(1000)
})

it('counts floating-point samples using the smaller clock delta', () => {
  const recorder = createStudyActivityRecorder('test')
  recorder.sample(sample(0, { monotonic: 100.1 }))
  recorder.sample(sample(1000, { monotonic: 1100.3 }))
  recorder.sample(sample(2000, { monotonic: 2100.1 }))
  expect(recorder.pending()[0]!.activeMs).toBe(1999)
  expect(studyActivitySchema.safeParse(recorder.pending()[0]).success).toBe(true)
})

it('starts new buckets after a same-day clock rollback without losing unsaved activity', () => {
  const recorder = createStudyActivityRecorder('test')
  recorder.sample(sample(0))
  recorder.sample(sample(1000))
  const saved = recorder.pending()
  recorder.sample(sample(2000, { wall: new Date(start - 10_000) }))
  recorder.sample(sample(3000, { wall: new Date(start - 9000) }))
  const rows = recorder.pending()
  expect(rows).toHaveLength(2)
  expect(rows.map((row) => row.activeMs)).toEqual([1000, 1000])
  expect(rows[0]).toBe(saved[0])
  expect(rows[1]!.id).not.toBe(rows[0]!.id)
  for (const row of rows) expect(studyActivitySchema.safeParse(row).success).toBe(true)
  recorder.acknowledge(saved)
  expect(recorder.pending()).toEqual([rows[1]])
})

it('does not reuse an old day bucket when the clock moves back a day and returns', () => {
  const recorder = createStudyActivityRecorder('test')
  recorder.sample(sample(0))
  recorder.sample(sample(1000))
  const saved = recorder.pending()
  recorder.sample(sample(2000, { wall: new Date(start - 86_400_000) }))
  recorder.sample(sample(3000, { wall: new Date(start - 86_399_000) }))
  recorder.sample(sample(4000, { wall: new Date(start + 2000) }))
  recorder.sample(sample(5000, { wall: new Date(start + 3000) }))
  const rows = recorder.pending()
  expect(rows).toHaveLength(3)
  expect(new Set(rows.map((row) => row.id)).size).toBe(3)
  expect(rows[0]!.studyDay).toBe(rows[2]!.studyDay)
  expect(rows[1]!.studyDay).not.toBe(rows[0]!.studyDay)
  expect(rows.map((row) => row.activeMs)).toEqual([1000, 1000, 1000])
  for (const row of rows) expect(studyActivitySchema.safeParse(row).success).toBe(true)
  recorder.acknowledge(saved)
  expect(recorder.pending()).toEqual(rows.slice(1))
})
