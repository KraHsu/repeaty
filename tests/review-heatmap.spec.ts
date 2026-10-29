import { test } from '@playwright/test'
import { reviewHeatmapFlow } from './fixtures/review-heatmap-flow'

test.use({ timezoneId: 'UTC' })

test('official heatmap installs independently and follows ratings, undo and plugin lifecycle', async ({
  page,
}, info) => {
  test.setTimeout(90_000)
  await page.goto('./')
  await reviewHeatmapFlow(page, info, 'web')
})
