import { test } from './fixture'
import {
  sourceExcerptFlow,
  excerptDuringRound,
  localLibrary,
} from '../fixtures/source-excerpt-flow'
test('desktop excerpts retain bodies, provenance and learning progress through restart and native backups', async ({
  page,
}, info) => {
  await sourceExcerptFlow(page, () => localLibrary(page), info)
})
test('desktop excerpts enter the next reading round and have their own schedule', async ({
  page,
}) => {
  await excerptDuringRound(page, () => localLibrary(page))
})
