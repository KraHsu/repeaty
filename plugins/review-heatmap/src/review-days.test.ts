import { expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import type { Review } from '@repeaty/plugin-api'
import { reviewCalendar, reviewDays, reviewLevel } from './review-days'

const source = new URL('./review-days.ts', import.meta.url).href
for (const [zone, expectedDay] of [
  ['UTC', '2026-10-28'],
  ['Asia/Shanghai', '2026-10-29'],
  ['America/New_York', '2026-10-28'],
]) {
  it(`groups local dates and keeps all 365 days across DST in ${zone}`, () => {
    const script = `
      import assert from 'node:assert/strict'
      import { reviewDays } from ${JSON.stringify(source)}
      const instant = '2026-10-28T16:30:00Z'
      const days = reviewDays([{ reviewedAt: instant }], new Date(instant))
      assert.equal(days.length, 365)
      assert.equal(new Set(days.map(day => day.key)).size, 365)
      assert.equal(days.at(-1).key, ${JSON.stringify(expectedDay)})
      assert.equal(days.at(-1).count, 1)
      assert.equal(days.slice(0, -1).every(day => day.count === 0), true)
      for (const [now, first, last] of [
        [new Date(2026, 2, 10, 12), '2025-03-11', '2026-03-10'],
        [new Date(2026, 10, 3, 12), '2025-11-04', '2026-11-03'],
        [new Date(2024, 2, 1, 12), '2023-03-03', '2024-03-01'],
      ]) {
        const dst = reviewDays([], now)
        assert.equal(dst[0].key, first)
        assert.equal(dst.at(-1).key, last)
        assert.equal(new Set(dst.map(day => day.key)).size, 365)
        for (let index = 1; index < dst.length; index++) {
          const next = new Date(dst[index - 1].date)
          next.setDate(next.getDate() + 1)
          assert.equal(dst[index].date.getTime(), next.getTime())
        }
      }
      assert.equal(reviewDays([], new Date(2024, 2, 1, 12)).at(-2).key, '2024-02-29')
      const midnight = new Date(2026, 9, 29, 0)
      const near = reviewDays([
        { reviewedAt: new Date(midnight.getTime() - 1).toISOString() },
        { reviewedAt: midnight.toISOString() },
      ], midnight)
      assert.equal(near.at(-2).count, 1)
      assert.equal(near.at(-1).count, 1)
    `
    const run = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      env: { ...process.env, TZ: zone },
      encoding: 'utf8',
    })
    expect(run.status, run.stderr || run.stdout).toBe(0)
  })
}

it('counts every saved rating in range, ignores invalid/outside dates, and reflects removal without mutation', () => {
  const today = new Date(2026, 9, 29, 12)
  const record = (id: string, reviewedAt: string): Readonly<Review> =>
    Object.freeze({ id, cardId: 'same-card', rating: 3, reviewedAt })
  const data = Object.freeze([
    record('old', new Date(2025, 9, 29, 23).toISOString()),
    record('first', new Date(2025, 9, 30, 0).toISOString()),
    record('one', today.toISOString()),
    record('two', today.toISOString()),
    record('next', new Date(2026, 9, 30).toISOString()),
    record('invalid', 'invalid'),
  ])
  const snapshot = JSON.stringify(data)
  const days = reviewDays(data, today)
  expect(days[0]!.count).toBe(1)
  expect(days.at(-1)!.count).toBe(2)
  expect(days.reduce((sum, day) => sum + day.count, 0)).toBe(3)
  expect(
    reviewDays(
      data.filter((review) => review.id !== 'two'),
      today,
    ).at(-1)!.count,
  ).toBe(1)
  expect(reviewDays([], today).every((day) => day.count === 0)).toBe(true)
  expect(JSON.stringify(data)).toBe(snapshot)
})

it('aligns each date to its weekday and pads only dates outside the 365-day range', () => {
  for (let date = 1; date <= 7; date++) {
    const calendar = reviewCalendar([], new Date(2026, 10, date, 12))
    expect(calendar.cells).toHaveLength(53 * 7)
    expect(calendar.cells.filter(Boolean)).toEqual(calendar.days)
    const first = calendar.cells.indexOf(calendar.days[0]!)
    const last = calendar.cells.indexOf(calendar.days.at(-1)!)
    expect(calendar.cells.slice(0, first).every((cell) => cell === null)).toBe(true)
    expect(calendar.cells.slice(last + 1).every((cell) => cell === null)).toBe(true)
    calendar.cells.forEach((day, index) => {
      if (day) expect(index % 7).toBe(day.date.getDay())
    })
  }
})

it('positions month labels over their first week and omits cramped partial months', () => {
  const october = reviewCalendar([], new Date(2026, 9, 29, 12))
  expect(october.months[0]!.key).toBe('2025-11')
  expect(october.months[0]!.column).toBe(0)
  expect(october.months.at(-1)!.key).toBe('2026-10')
  const november = reviewCalendar([], new Date(2026, 10, 2, 12))
  expect(november.months[0]!.key).toBe('2025-11')
  expect(november.months.at(-1)!.key).toBe('2026-10')
  for (const calendar of [october, november]) {
    expect(new Set(calendar.months.map((month) => month.key)).size).toBe(calendar.months.length)
    for (const month of calendar.months) {
      const week = calendar.cells.slice(month.column * 7, (month.column + 1) * 7)
      expect(week.some((day) => day?.key.slice(0, 7) === month.key)).toBe(true)
      expect(calendar.cells.length / 7 - month.column).toBeGreaterThanOrEqual(3)
    }
  }
})

it('uses zero plus four stable review-count intensities', () => {
  expect([0, 1, 2, 3, 5, 6, 9, 10, 1000].map(reviewLevel)).toEqual([0, 1, 1, 2, 2, 3, 3, 4, 4])
})
