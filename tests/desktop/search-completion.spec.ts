import { test } from './fixture'
import {
  searchCompletionFlow,
  searchCompletionCompositionFlow,
} from '../fixtures/search-completion-flow'

test('desktop card search completes actual tags, decks and syntax without changing data', async ({
  page,
}, info) => {
  await searchCompletionFlow(page, info)
})

test('desktop card search preserves IME input and fits suggestions in a narrow window', async ({
  page,
}, info) => {
  await searchCompletionCompositionFlow(page, info, 500)
})
