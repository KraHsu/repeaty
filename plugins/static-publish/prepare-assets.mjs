import { build } from 'vite'
import { copyFile, mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
const root = fileURLToPath(new URL('.', import.meta.url))
for (const [entry, filename] of [
  ['generator.worker.ts', 'publish-worker.js'],
  ['cloudflare/worker.ts', 'cloudflare-worker.js'],
]) {
  const output = await build({
    configFile: false,
    root,
    build: {
      write: false,
      target: 'es2022',
      minify: true,
      lib: { entry: root + '/src/' + entry, formats: ['es'], fileName: filename },
      rolldownOptions: { output: { codeSplitting: false } },
    },
  })
  const code = (Array.isArray(output) ? output[0] : output).output.find(
    (item) => item.type === 'chunk' && item.isEntry,
  )?.code
  if (!code || Buffer.byteLength(code) > 4 * 1024 * 1024)
    throw new Error('Publishing worker exceeds 4 MiB')
  await mkdir(root + '/assets/licenses', { recursive: true })
  await writeFile(root + '/assets/' + filename, code)
}
const require = createRequire(import.meta.url)
for (const [name, filename] of [
  ['liquidjs', 'LICENSE'],
  ['markdown-it', 'LICENSE'],
  ['highlight.js', 'LICENSE'],
  ['katex', 'LICENSE'],
  ['parse5', 'LICENSE'],
  ['@zip.js/zip.js', 'LICENSE'],
  ['@noble/hashes', 'LICENSE'],
]) {
  let folder = dirname(require.resolve(name === '@noble/hashes' ? '@noble/hashes/blake3.js' : name))
  for (let i = 0; i < 5; i++) {
    try {
      await copyFile(
        resolve(folder, filename),
        root + '/assets/licenses/' + name.replaceAll('/', '-').replaceAll('@', '') + '.txt',
      )
      break
    } catch (error) {
      if (i === 4) throw error
      folder = dirname(folder)
    }
  }
}
