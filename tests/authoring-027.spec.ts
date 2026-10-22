import { test } from './fixtures/empty-workspace'
import {
  rendering027Flow,
  modal027Flow,
  reviewActions027Flow,
  readingUndo027Flow,
  practiceUndo027Flow,
} from './fixtures/authoring-027-flow'
import { readBrowserLibrary } from './fixtures/adaptive-mixed-flow'
test('review add, edit, delete, media restoration and keyboard undo share one history', async ({
  page,
}) => reviewActions027Flow(page, () => readBrowserLibrary(page)))
test('consistent content alignment, HTML isolation, paragraphs and all math delimiters', async ({
  page,
}, info) => rendering027Flow(page, info))
test('modal dismissal requires both pointer endpoints outside', async ({ page }) =>
  modal027Flow(page))

test('keyboard undo follows reading and mixed-queue action order', async ({ page }) =>
  readingUndo027Flow(page, () => readBrowserLibrary(page)))

test('practice keyboard undo follows edits and additions without changing schedules', async ({
  page,
}) => practiceUndo027Flow(page, () => readBrowserLibrary(page)))
