import { test } from './fixtures/empty-workspace'
import { formatCleanupFlow } from './fixtures/format-cleanup-flow'
test('official formatting cleanup previews, applies and undoes without losing versions on uninstall', async ({
  page,
}) => {
  test.setTimeout(90_000)
  await formatCleanupFlow(page, 'web')
})
