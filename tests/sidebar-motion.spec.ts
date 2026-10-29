import { test } from '@playwright/test'
import {
  sidebarSelectionMotionFlow,
  sidebarSelectionReducedMotionFlow,
} from './fixtures/sidebar-motion-flow'

test.beforeEach(async ({ page }) => {
  await page.goto('./')
})

test('web sidebar selection slides in both rail modes and follows resizing and responsive navigation', async ({
  page,
}, info) => {
  await sidebarSelectionMotionFlow(page, info, false)
})

test('web sidebar selection moves immediately in both rail modes with reduced motion', async ({
  page,
}) => {
  await sidebarSelectionReducedMotionFlow(page)
})
