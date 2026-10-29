import { test } from './fixtures/empty-workspace'
import {
  searchCompletionFlow,
  searchCompletionCompositionFlow,
} from './fixtures/search-completion-flow'

test('card search completes actual tags, decks and syntax without changing data', async ({
  page,
}, info) => {
  await searchCompletionFlow(page, info)
})

test('card search preserves IME input and fits its suggestions on narrow screens', async ({
  page,
}, info) => {
  await searchCompletionCompositionFlow(page, info, 390)
})
