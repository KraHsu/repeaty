import { test } from './fixture'
import {
  rendering027Flow,
  modal027Flow,
  reviewActions027Flow,
  readingUndo027Flow,
  practiceUndo027Flow,
} from '../fixtures/authoring-027-flow'
import { readBrowserLibrary } from '../fixtures/adaptive-mixed-flow'
test('desktop review actions and keyboard undo preserve stored media', async ({ page }) =>
  reviewActions027Flow(page, () => readBrowserLibrary(page)))
test('desktop content rendering matches the static edition', async ({ page }, info) =>
  rendering027Flow(page, info))
test('desktop modals retain drafts across crossing pointer gestures', async ({ page }) =>
  modal027Flow(page))

test('keyboard undo follows reading and mixed-queue action order', async ({ page }) =>
  readingUndo027Flow(page, () => readBrowserLibrary(page)))

test('practice keyboard undo follows edits and additions without changing schedules', async ({
  page,
}) => practiceUndo027Flow(page, () => readBrowserLibrary(page)))
