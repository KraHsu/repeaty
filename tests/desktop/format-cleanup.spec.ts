import { test } from './fixture'
import { formatCleanupFlow } from '../fixtures/format-cleanup-flow'
test('desktop official formatting cleanup preserves source versions and study data through undo and uninstall', async ({
  page,
}) => {
  test.setTimeout(90_000)
  await formatCleanupFlow(page, 'desktop')
})
