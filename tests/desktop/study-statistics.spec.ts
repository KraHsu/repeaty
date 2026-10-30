import { test } from './fixture'
import { studyStatisticsFlow } from '../fixtures/study-statistics-flow'

test.use({ timezoneId: 'Asia/Shanghai' })
test('official study statistics distinguishes records and plans and preserves library isolation', async ({
  page,
}, info) => {
  test.setTimeout(120_000)
  await studyStatisticsFlow(page, info)
})
