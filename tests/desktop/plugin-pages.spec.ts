import { test } from './fixture'
import { pluginPagesFlow } from '../fixtures/plugin-pages-flow'

test('desktop plugin pages and widgets clean up across navigation, disable, uninstall and workspace changes', async ({
  page,
}, info) => {
  test.setTimeout(90_000)
  await pluginPagesFlow(page, info, 'desktop')
})
