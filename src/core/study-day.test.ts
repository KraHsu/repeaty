import { afterEach, expect, it, vi } from 'vitest'
import { studyDay, studyDayStart, nextStudyDayStart, scheduledStudyDayStart } from './study-day'
import { studySettingsSchema } from './study-settings'

afterEach(() => vi.unstubAllEnvs())
it.each(['UTC', 'Asia/Shanghai', 'America/New_York'])(
  'uses calendar days around a configurable boundary in %s',
  (zone) => {
    vi.stubEnv('TZ', zone)
    const settings = studySettingsSchema.parse({ dayStartHour: 4 })
    const before = new Date(2026, 9, 18, 3, 59, 59, 999)
    const at = new Date(2026, 9, 18, 4)
    expect(studyDay(before, settings)).toBe('2026-10-17')
    expect(studyDay(at, settings)).toBe('2026-10-18')
    expect(studyDayStart(before, settings)).toEqual(new Date(2026, 9, 17, 4))
    expect(nextStudyDayStart(before, settings)).toEqual(at)
    expect(scheduledStudyDayStart(before, 2, settings)).toEqual(new Date(2026, 9, 19, 4))
    expect(studyDay(before)).toBe('2026-10-18')
  },
)
it('keeps DST spring and autumn days at their actual 23 and 25 hour duration', () => {
  vi.stubEnv('TZ', 'America/New_York')
  const spring = new Date('2026-03-08T06:30:00Z')
  const autumn = new Date('2026-11-01T05:30:00Z')
  expect(spring.getHours()).toBe(1)
  expect(nextStudyDayStart(spring).getTime() - studyDayStart(spring).getTime()).toBe(23 * 3600000)
  expect(nextStudyDayStart(autumn).getTime() - studyDayStart(autumn).getTime()).toBe(25 * 3600000)
  // A nonexistent 02:00 boundary resolves to 03:00; both copies of 01:30 in
  // autumn belong to the same study day rather than being counted twice.
  expect(studyDay(new Date('2026-03-08T06:59:59Z'), { dayStartHour: 2 })).toBe('2026-03-07')
  expect(studyDay(new Date('2026-03-08T07:00:00Z'), { dayStartHour: 2 })).toBe('2026-03-08')
  expect(studyDay(new Date('2026-11-01T05:30:00Z'), { dayStartHour: 1 })).toBe('2026-11-01')
  expect(studyDay(new Date('2026-11-01T06:30:00Z'), { dayStartHour: 1 })).toBe('2026-11-01')
})
it('rejects invalid dates, boundaries and non-calendar intervals', () => {
  expect(() => studyDay(new Date('invalid'))).toThrow()
  for (const dayStartHour of [-1, 24, 1.5, Infinity])
    expect(() => studyDay(new Date(), { dayStartHour })).toThrow()
  for (const days of [-1, 1.5, Infinity, 36501])
    expect(() => scheduledStudyDayStart(new Date(), days)).toThrow()
})
