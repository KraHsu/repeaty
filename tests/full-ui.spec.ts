import { test } from './fixtures/empty-workspace'
import { fullUiFlow } from './fixtures/full-ui-flow'

test('card editing, review, materials and dialogs share one GUI without changing drafts or scores', async ({
  page,
}, info) => {
  test.setTimeout(90_000)
  await fullUiFlow(page, info)
})
