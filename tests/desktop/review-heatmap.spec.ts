import { test } from './fixture'
import { reviewHeatmapFlow } from '../fixtures/review-heatmap-flow'

test.use({ timezoneId: 'Asia/Shanghai' })

test('desktop official heatmap preserves learning records through management and workspace changes', async ({
  page,
}, info) => {
  test.setTimeout(90_000)
  await reviewHeatmapFlow(page, info, 'desktop')
})
