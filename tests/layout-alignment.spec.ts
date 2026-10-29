import { test } from '@playwright/test'
import {
  dashboardAndBackupAlignmentFlow,
  settingsAlignmentFlow,
} from './fixtures/layout-alignment-flow'

test.beforeEach(async ({ page }) => {
  await page.goto('./')
})

test('settings branches and chevrons align with labels at normal, narrow and large font sizes', async ({
  page,
}, info) => {
  await settingsAlignmentFlow(page, info, 390)
})

test('dashboard icons are centered and backup sections share the page content width', async ({
  page,
}, info) => {
  await dashboardAndBackupAlignmentFlow(page, info, 390)
})
