import { buildPlugin } from './build-plugin.mjs'
import { mkdir, writeFile } from 'node:fs/promises'
const ids = [
  'review-history',
  'leetcode',
  'typed-answer',
  'review-heatmap',
  'format-cleanup',
  'pdf-reader',
  'document-reader',
  'visual-occlusion',
  'obsidian',
  'readwise',
  'fsrs-optimizer',
  'study-statistics',
  'assistant',
  'static-publish',
  'wordpress-publish',
  'discourse-publish',
]
await mkdir('plugins/packages', { recursive: true })
for (const id of ids) {
  const bundle = await buildPlugin('plugins/' + id)
  await writeFile('plugins/packages/' + id + '.repeaty-plugin', JSON.stringify(bundle) + '\n')
}
