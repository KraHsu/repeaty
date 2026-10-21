import { test, headers } from './fixture'
import {
  rendering027Flow,
  modal027Flow,
  reviewActions027Flow,
  readingUndo027Flow,
  practiceUndo027Flow,
} from '../fixtures/authoring-027-flow'
test('account review actions and keyboard undo persist in SQLite', async ({ page, request }) =>
  reviewActions027Flow(
    page,
    async () => (await (await request.get('api/library', { headers })).json()).library,
  ))
test('account content rendering matches the static edition', async ({ page }, info) =>
  rendering027Flow(page, info))
test('account modals retain drafts across crossing pointer gestures', async ({ page }) =>
  modal027Flow(page))

test('account keyboard undo preserves reading and mixed-queue progress', async ({
  page,
  request,
}) =>
  readingUndo027Flow(
    page,
    async () => (await (await request.get('api/library', { headers })).json()).library,
  ))

test('practice keyboard undo follows edits and additions without changing schedules', async ({
  page,
  request,
}) =>
  practiceUndo027Flow(
    page,
    async () => (await (await request.get('api/library', { headers })).json()).library,
  ))
