import { test } from './fixtures/empty-workspace'
import { rendering027Flow, modal027Flow } from './fixtures/authoring-027-flow'
test('consistent content alignment, HTML isolation, paragraphs and all math delimiters', async ({
  page,
}, info) => rendering027Flow(page, info))
test('modal dismissal requires both pointer endpoints outside', async ({ page }) =>
  modal027Flow(page))
