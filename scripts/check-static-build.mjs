import { readFile, access, unlink } from 'node:fs/promises'
import { join } from 'node:path'
const manifest = JSON.parse(await readFile('dist/.vite/manifest.json', 'utf8'))
for (const key of Object.keys(manifest)) {
  if (key.startsWith('plugins/') || key.startsWith('docs/examples/'))
    throw new Error(`Plugin source leaked into the application build: ${key}`)
  if (
    key.includes('plugins/leetcode') ||
    key.includes('backend/') ||
    key.includes('ServerConnection') ||
    key.includes('AccountControls') ||
    key.includes('desktop/') ||
    key.includes('@tauri-apps')
  )
    throw new Error(`Backend module leaked into the static build: ${key}`)
}
try {
  await access('dist/leetcode-connector.zip')
  throw new Error('The obsolete browser extension must not be deployed.')
} catch (error) {
  if (error.code !== 'ENOENT') throw error
}
console.log('Static build contains no backend or LeetCode modules.')
// Build metadata is only used for the check above. Pages excludes hidden files;
// remove it locally too, so offline browser tests exercise the deployed artifact.
await unlink('dist/.vite/manifest.json')
const worker = await readFile('dist/sw.js', 'utf8')
const files = JSON.parse(worker.match(/^const FILES = (.+)$/m)?.[1] ?? 'null')
if (!Array.isArray(files)) throw new Error('Missing service worker precache list.')
for (const file of files) {
  if (file.split('/').some((part) => part.startsWith('.')))
    throw new Error(`Hidden build metadata must not be precached: ${file}`)
  await access(join('dist', file))
}
console.log('Every precached file exists in the deployable static artifact.')
