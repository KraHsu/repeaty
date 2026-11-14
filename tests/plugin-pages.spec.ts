import { test } from '@playwright/test'
import { pluginPagesFlow } from './fixtures/plugin-pages-flow'

test('external plugin pages and overview widgets share the host UI without owning learning data', async ({
  page,
}, info) => {
  test.setTimeout(90_000)
  await page.goto('./')
  await pluginPagesFlow(page, info, 'web')
})
