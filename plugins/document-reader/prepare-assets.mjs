import { build } from 'vite'
import { copyFile, mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('.', import.meta.url))
const result = await build({
  configFile: false,
  root,
  build: {
    write: false,
    target: 'es2022',
    lib: { entry: root + '/src/parser.worker.ts', formats: ['es'], fileName: 'document-worker' },
    rolldownOptions: { output: { codeSplitting: false } },
    minify: true,
  },
})
const source = (Array.isArray(result) ? result[0] : result).output.find(
  (file) => file.type === 'chunk' && file.isEntry,
)?.code
if (!source || Buffer.byteLength(source) > 1024 * 1024)
  throw new Error('Document worker exceeds its 1 MiB budget')
await mkdir(root + '/assets', { recursive: true })
await writeFile(root + '/assets/document-worker.js', source)
await mkdir(root + '/assets/licenses', { recursive: true })
for (const name of ['parse5.txt', 'zip.js.txt'])
  await copyFile(root + '/licenses/' + name, root + '/assets/licenses/' + name)
