import { test } from './fixture'
import { readFile } from 'node:fs/promises'
import {
  materialPluginFlow,
  materialPluginInvalidImportFlow,
  materialPluginWorkerFlow,
} from '../fixtures/material-plugin-flow'

test('native workspace persists independently imported materials, locators and originals after plugin removal', async ({
  page,
}, info) => {
  test.setTimeout(120_000)
  await materialPluginFlow(page, info)
})

test('native workspace has no partial materials after invalid imports or cancelled previews', async ({
  page,
}, info) => {
  await materialPluginInvalidImportFlow(page, info)
})

test('native workspace material parser uses real workers and releases resources on completion, failure and cancellation', async ({
  page,
}, info) => {
  const configuration = JSON.parse(await readFile('src-tauri/tauri.conf.json', 'utf8'))
  await page.route(
    (url) => url.pathname === '/',
    async (route) => {
      const response = await route.fetch()
      await route.fulfill({
        response,
        headers: {
          ...response.headers(),
          'content-security-policy': configuration.app.security.csp,
        },
      })
    },
  )
  await materialPluginWorkerFlow(page, info)
})
