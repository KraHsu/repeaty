import { test } from './fixture'
import { reviewPolishFlow, skillSettingsFlow } from '../fixtures/polish-flow'
import { readBrowserLibrary } from '../fixtures/adaptive-mixed-flow'
test('desktop review editing and the frontend history plugin preserve progress', async ({
  page,
}, info) => {
  await reviewPolishFlow(page, () => readBrowserLibrary(page), info)
})
test('desktop settings and no-MCP skill use the native export path', async ({ page }, info) => {
  await skillSettingsFlow(page, () => readBrowserLibrary(page), info)
})
