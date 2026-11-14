import { test } from '@playwright/test'
import {
  materialPluginFlow,
  materialPluginInvalidImportFlow,
  materialPluginWorkerFlow,
} from './fixtures/material-plugin-flow'

test('independent material importer and reader keep original bytes, source locators and study data across lifecycle changes', async ({
  page,
}, info) => {
  test.setTimeout(120_000)
  await page.goto('./')
  await materialPluginFlow(page, info)
})

test('invalid later candidates and cancelled previews leave the browser library unchanged', async ({
  page,
}, info) => {
  await page.goto('./')
  await materialPluginInvalidImportFlow(page, info)
})

test('real parser workers finish, fail and cancel with worker and blob URL cleanup', async ({
  page,
}, info) => {
  await materialPluginWorkerFlow(page, info)
})
