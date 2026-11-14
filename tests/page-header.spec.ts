import { test } from '@playwright/test'
import { pageHeaderFlow } from './fixtures/page-header-flow'

test('web pages share title and action geometry at wide, narrow and large font sizes', async ({
  page,
}, info) => {
  await page.goto('./')
  await pageHeaderFlow(page, info, 390, 'web')
})
