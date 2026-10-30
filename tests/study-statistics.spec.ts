import { test } from './fixtures/empty-workspace'
import { studyStatisticsFlow } from './fixtures/study-statistics-flow'

test.use({ timezoneId: 'Asia/Shanghai' })
test('official study statistics uses the same scoped SDK and records in the browser library', async ({
  page,
}, info) => {
  test.setTimeout(120_000)
  await studyStatisticsFlow(page, info, false)
})
