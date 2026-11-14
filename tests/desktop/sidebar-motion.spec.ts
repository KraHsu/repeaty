import { test } from './fixture'
import {
  sidebarSelectionMotionFlow,
  sidebarSelectionReducedMotionFlow,
} from '../fixtures/sidebar-motion-flow'

test('desktop sidebar selection slides in both rail modes and follows resizing and a scrolled narrow rail', async ({
  page,
}, info) => {
  await sidebarSelectionMotionFlow(page, info, true)
})

test('desktop sidebar selection moves immediately in both rail modes with reduced motion', async ({
  page,
}) => {
  await sidebarSelectionReducedMotionFlow(page)
})
