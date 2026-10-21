import { test } from './fixture'
import { rendering027Flow, modal027Flow } from '../fixtures/authoring-027-flow'
test('account content rendering matches the static edition', async ({ page }, info) =>
  rendering027Flow(page, info))
test('account modals retain drafts across crossing pointer gestures', async ({ page }) =>
  modal027Flow(page))
