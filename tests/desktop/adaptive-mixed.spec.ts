import { test } from './fixture'
import { adaptiveFlow, mixedFlow, readBrowserLibrary } from '../fixtures/adaptive-mixed-flow'
test('desktop adaptive reading persists feedback, undo and backups', async ({ page }, info) => {
  await adaptiveFlow(page, () => readBrowserLibrary(page), info)
})
test('desktop mixed study keeps reading and card scheduling independent', async ({
  page,
}, info) => {
  await mixedFlow(page, () => readBrowserLibrary(page), info)
})
