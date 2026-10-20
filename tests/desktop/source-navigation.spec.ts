import { test } from './fixture'
import { navigationFlow } from '../fixtures/source-navigation-flow'
import { localLibrary } from '../fixtures/source-excerpt-flow'
test('desktop source navigation preserves exact selections, independent queues and native backups', async ({
  page,
}, info) => {
  await navigationFlow(page, () => localLibrary(page), info)
})
