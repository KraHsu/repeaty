// The canonical application schema also describes native CLI/MCP requests. Rust only transports it.
import { createServer } from 'vite'
import { z } from 'zod'
import { format } from 'prettier'
import { readFile, writeFile } from 'node:fs/promises'

const vite = await createServer({
  // Core schemas need only TypeScript loading; avoid the UI/plugin build and dependency scanner.
  configFile: false,
  optimizeDeps: { noDiscovery: true, include: [] },
  server: { middlewareMode: true, watch: null, hmr: false, ws: false },
  appType: 'custom',
})
try {
  const contract = await vite.ssrLoadModule('/src/core/automation.ts')
  const schemas = {}
  for (const [command, name] of Object.entries({
    query: 'AutomationQuerySchema',
    preview: 'AutomationRequestSchema',
    apply: 'AutomationApplySchema',
  })) {
    schemas[command] = {
      type: 'object',
      ...z.toJSONSchema(contract[name], { unrepresentable: 'any', io: 'input' }),
    }
  }
  schemas.status = { type: 'object', additionalProperties: false }
  schemas.operation = {
    type: 'object',
    additionalProperties: false,
    required: ['operationId'],
    properties: { operationId: { type: 'string', minLength: 1, maxLength: 100 } },
  }
  const source = await format(JSON.stringify(schemas), { parser: 'json', printWidth: 100 })
  const path = 'src-tauri/src/mcp/automation.schema.json'
  if (process.argv.includes('--check')) {
    if ((await readFile(path, 'utf8')) !== source)
      throw new Error('Run node scripts/cli-schema.mjs and commit the updated CLI/MCP schema.')
  } else await writeFile(path, source)
} finally {
  await vite.close()
}
