import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'

const root = dirname(fileURLToPath(import.meta.url))
const assets = join(root, 'assets')
await mkdir(assets, { recursive: true })
const wasm = fileURLToPath(
  import.meta.resolve('@open-spaced-repetition/binding-wasm32-wasip1/wasm'),
)
await writeFile(join(assets, 'optimizer.wasm'), await readFile(wasm))
await writeFile(join(assets, 'LICENSE.binding'), await readFile(join(dirname(wasm), 'LICENSE')))
// Bundle browser-only JS into one host-owned worker; there are no runtime node imports.
const output = await build({
  configFile: false,
  root,
  define: { 'process.env.NODE_ENV': '"production"' },
  build: {
    write: false,
    target: 'es2022',
    minify: true,
    lib: { entry: join(root, 'src/optimizer.worker.ts'), formats: ['es'], fileName: 'worker' },
    rolldownOptions: { output: { codeSplitting: false } },
  },
})
const worker = (Array.isArray(output) ? output[0] : output).output.find(
  (entry) => entry.type === 'chunk' && entry.isEntry,
)
if (!worker || worker.code.length > 4 * 1024 * 1024)
  throw new Error('Optimizer worker is missing or exceeds the host resource limit')
await writeFile(join(assets, 'optimizer.worker.mjs'), worker.code)
const notices = [
  '@napi-rs/wasm-runtime',
  '@emnapi/core',
  '@emnapi/runtime',
  '@tybys/wasm-util',
  'tslib',
]
let licenses = ''
for (const name of notices) {
  // Package export maps may hide package.json; walk up from the resolved JS entry.
  let directory = dirname(fileURLToPath(import.meta.resolve(name)))
  for (;;) {
    let pkg
    try {
      pkg = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'))
    } catch {}
    if (pkg?.name === name) break
    const parent = dirname(directory)
    if (parent === directory) throw new Error(`Could not resolve license for ${name}`)
    directory = parent
  }
  let license
  for (const filename of ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'License.txt']) {
    try {
      license = await readFile(join(directory, filename), 'utf8')
      break
    } catch {}
  }
  // wasm-runtime's npm files list omits its repository license. Keep the upstream
  // notice locally so building the plugin never needs a network request.
  if (!license && name === '@napi-rs/wasm-runtime')
    license = await readFile(join(root, 'licenses/LICENSE.napi-rs'), 'utf8')
  if (!license) throw new Error(`Missing license for ${name}`)
  if (name === 'tslib')
    license += '\n' + (await readFile(join(directory, 'CopyrightNotice.txt'), 'utf8'))
  licenses += `\n\n${name}\n${'='.repeat(name.length)}\n${license}`
}
await writeFile(join(assets, 'LICENSE.runtime.txt'), licenses.replace(/\r\n/g, '\n').trim() + '\n')
