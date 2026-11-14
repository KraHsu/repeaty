import assert from 'node:assert/strict'
import { test } from 'node:test'
import { spawnSync } from 'node:child_process'

const source = new URL('../src/review-days.ts', import.meta.url).href
for (const [zone, expectedDay] of [
  ['UTC', '2026-10-28'],
  ['Asia/Shanghai', '2026-10-29'],
  ['America/New_York', '2026-10-28'],
]) {
  test(`review counts use local dates without gaps in ${zone}`, () => {
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
      const dst = reviewDays([], new Date(2026, 2, 10, 12))
      assert.equal(dst[0].key, '2026-2-11')
      assert.equal(dst.at(-1).key, '2026-3-10')
      assert.equal(new Set(dst.map(day => day.key)).size, 28)
    `
    const run = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      env: { ...process.env, TZ: zone },
      encoding: 'utf8',
    })
    assert.equal(run.status, 0, run.stderr || run.stdout)
  })
}
