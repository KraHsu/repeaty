import { createServer } from 'vite'
import { z } from 'zod'
import { format } from 'prettier'
import { readFile, writeFile } from 'node:fs/promises'
const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' })
try {
  const model = await vite.ssrLoadModule('/src/core/model.ts')
  const schemas = {}
  for (const [store, name] of Object.entries({
    decks: 'deckSchema',
    notes: 'noteSchema',
    cards: 'cardSchema',
    reviews: 'reviewSchema',
    media: 'mediaSchema',
    savedSearches: 'savedSearchSchema',
  })) {
    schemas[store] = z.toJSONSchema(model[name], { unrepresentable: 'any' })
  }
  const source = await format(JSON.stringify(schemas), { parser: 'json', printWidth: 100 })
  const path = 'server/schema/entities.json'
  if (process.argv.includes('--check')) {
    if ((await readFile(path, 'utf8')) !== source)
      throw new Error('Run npm run schema:server and commit the updated server schema.')
  } else await writeFile(path, source)
} finally {
  await vite.close()
}
