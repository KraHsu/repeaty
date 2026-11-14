import { createServer } from 'vite'
import { z } from 'zod'
import { format } from 'prettier'
import { readFile, writeFile } from 'node:fs/promises'
const vite = await createServer({
  configFile: false,
  optimizeDeps: { noDiscovery: true, include: [] },
  server: { middlewareMode: true, watch: null, hmr: false, ws: false },
  appType: 'custom',
})
try {
  const model = await vite.ssrLoadModule('/src/core/model.ts')
  const practices = await vite.ssrLoadModule('/src/core/practice-data.ts')
  const sources = await vite.ssrLoadModule('/src/core/source-data.ts')
  const schemas = {}
  for (const [store, name] of Object.entries({
    studySettings: 'studySettingsSchema',
    studyEvents: 'studyEventSchema',
    studyActivity: 'studyActivitySchema',
    fsrsModels: 'fsrsModelSchema',
    sources: 'sourceSchema',
    materialReceipts: 'materialReceiptSchema',
    automationReceipts: 'automationReceiptSchema',
    materialFolders: 'materialFolderSchema',
    materialCollections: 'materialCollectionSchema',
    sourceConnections: 'sourceConnectionSchema',
    sourceCandidates: 'sourceCandidateSchema',
    decks: 'deckSchema',
    notes: 'noteSchema',
    cards: 'cardSchema',
    reviews: 'reviewSchema',
    media: 'mediaSchema',
    savedSearches: 'savedSearchSchema',
    practices: 'practiceSchema',
    attempts: 'attemptSchema',
  })) {
    schemas[store] = z.toJSONSchema(model[name] ?? practices[name] ?? sources[name], {
      unrepresentable: 'any',
    })
  }
  const source = await format(JSON.stringify(schemas), { parser: 'json', printWidth: 100 })
  const path = 'crates/workspace-store/schema/entities.json'
  if (process.argv.includes('--check')) {
    if ((await readFile(path, 'utf8')) !== source)
      throw new Error('Run npm run schema:workspace and commit the updated native schema.')
  } else await writeFile(path, source)
} finally {
  await vite.close()
}
