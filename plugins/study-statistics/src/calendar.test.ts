import { afterEach, describe, expect, it } from 'vitest'
import {
  calendarCells,
  displayDate,
  dueDateLabel,
  localDateKey,
  monthTotals,
  nextBoundary,
  shiftDay,
  statisticsWindow,
} from './calendar'
import { duration } from './text'
import { locale } from '../test/plugin-api'
import type { StudyStatisticsDay } from '@repeaty/plugin-api'

const originalTimezone = process.env.TZ
afterEach(() => {
  process.env.TZ = originalTimezone
  locale.value = 'zh-CN'
})

describe.each(['UTC', 'Asia/Shanghai', 'America/New_York'])('calendar dates in %s', (timezone) => {
  it('shows saved due instants in local time while keeping reading calendar dates unchanged', () => {
    process.env.TZ = timezone
    const localMidnight = new Date(2026, 9, 31).toISOString()
    expect(dueDateLabel(localMidnight)).toBe('2026-10-31')
    expect(dueDateLabel('2026-10-31')).toBe('2026-10-31')
    expect(dueDateLabel(new Date(2026, 10, 1).toISOString())).toBe('2026-11-01')
  })
  it('keeps leap dates and a fixed twelve-month window through DST', () => {
    process.env.TZ = timezone
    const window = statisticsWindow('2024-02-29')
    expect(window).toEqual({
      from: '2023-09-01',
      to: '2024-08-31',
      months: [
        '2023-09',
        '2023-10',
        '2023-11',
        '2023-12',
        '2024-01',
        '2024-02',
        '2024-03',
        '2024-04',
        '2024-05',
        '2024-06',
        '2024-07',
        '2024-08',
      ],
    })
    expect(shiftDay('2024-03-10', 1)).toBe('2024-03-11')
    expect(shiftDay('2024-03-01', -1)).toBe('2024-02-29')
    expect(localDateKey(displayDate('2024-11-03'))).toBe('2024-11-03')
    const cells = calendarCells('2024-02')
    expect(cells).toHaveLength(42)
    expect(cells.slice(0, 4)).toEqual([null, null, null, '2024-02-01'])
    expect(cells.filter(Boolean)).toHaveLength(29)
    expect(nextBoundary(new Date(2024, 2, 9, 12), 4)).toEqual(new Date(2024, 2, 10, 4))
    expect(nextBoundary(new Date(2024, 2, 10, 3), 4)).toEqual(new Date(2024, 2, 10, 4))
  })
})
it('preserves unknown periods and distinguishes zero from less than one minute', () => {
  const day: StudyStatisticsDay = {
    day: '2026-10-01',
    reviews: 2,
    readings: null,
    practices: null,
    foregroundMs: null,
    readingMs: null,
    reviewMs: null,
    practiceMs: null,
    scheduledCards: 0,
    scheduledReadings: 0,
  }
  expect(monthTotals([day], '2026-10')).toMatchObject({
    reviews: 2,
    readings: null,
    practices: null,
    foregroundMs: null,
  })
  expect(duration(null)).toBe('—')
  expect(duration(0)).toBe('0 分钟')
  expect(duration(1_000)).toBe('不足 1 分钟')
  locale.value = 'en'
  expect(duration(3_660_000)).toBe('1 h 1 min')
})
