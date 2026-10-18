import { readFile, access } from 'node:fs/promises'
const manifest = JSON.parse(await readFile('dist/.vite/manifest.json', 'utf8'))
for (const key of Object.keys(manifest)) {
  if (
    key.includes('plugins/leetcode') ||
    key.includes('backend/') ||
    key.includes('ServerConnection')
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
