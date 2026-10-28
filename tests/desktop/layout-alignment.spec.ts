import { test } from './fixture'
import {
  dashboardAndBackupAlignmentFlow,
  settingsAlignmentFlow,
} from '../fixtures/layout-alignment-flow'

test('desktop settings branches and chevrons align at normal, narrow and large font sizes', async ({
  page,
}, info) => {
  await settingsAlignmentFlow(page, info, 500)
})

test('desktop dashboard icons are centered and backup sections share the page content width', async ({
  page,
}, info) => {
  await dashboardAndBackupAlignmentFlow(page, info, 500)
})
