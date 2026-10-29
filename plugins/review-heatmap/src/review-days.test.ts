import { expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import type { Review } from '@repeaty/plugin-api'
import { reviewDays } from './review-days'

const source = new URL('./review-days.ts', import.meta.url).href
for (const [zone, expectedDay] of [
  ['UTC', '2026-10-28'],
  ['Asia/Shanghai', '2026-10-29'],
  ['America/New_York', '2026-10-28'],
]) {
  it(`groups local dates and keeps all 28 days across DST in ${zone}`, () => {
    const script = `
      import assert from 'node:assert/strict'
      import { reviewDays } from ${JSON.stringify(source)}
      const instant = '2026-10-28T16:30:00Z'
      const days = reviewDays([{ reviewedAt: instant }], new Date(instant))
      assert.equal(days.length, 28)
      assert.equal(new Set(days.map(day => day.key)).size, 28)
      assert.equal(days.at(-1).key, ${JSON.stringify(expectedDay)})
      assert.equal(days.at(-1).count, 1)
      assert.equal(days.slice(0, -1).every(day => day.count === 0), true)
      for (const [now, first, last] of [
        [new Date(2026, 2, 10, 12), '2026-02-11', '2026-03-10'],
        [new Date(2026, 10, 3, 12), '2026-10-07', '2026-11-03'],
      ]) {
        const dst = reviewDays([], now)
        assert.equal(dst[0].key, first)
        assert.equal(dst.at(-1).key, last)
        assert.equal(new Set(dst.map(day => day.key)).size, 28)
      }
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
    record('old', new Date(2026, 9, 1, 23).toISOString()),
    record('first', new Date(2026, 9, 2, 0).toISOString()),
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
