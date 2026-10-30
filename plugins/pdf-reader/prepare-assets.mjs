import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const pdfjs = dirname(fileURLToPath(import.meta.resolve('pdfjs-dist/package.json')))
const assets = join(root, 'assets')
await mkdir(assets, { recursive: true })
for (const folder of ['cmaps', 'standard_fonts', 'wasm', 'iccs'])
  await cp(join(pdfjs, folder), join(assets, folder), { recursive: true })
await cp(join(pdfjs, 'build/pdf.worker.min.mjs'), join(assets, 'pdf.worker.min.mjs'))
await writeFile(join(assets, 'LICENSE.pdfjs'), await readFile(join(pdfjs, 'LICENSE')))
