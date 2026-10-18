import { mkdir, readFile, writeFile } from 'node:fs/promises'
import ts from 'typescript'
import { ZipWriter, BlobWriter, TextReader } from '@zip.js/zip.js'

await mkdir('dist-connector', { recursive: true })
const writer = new BlobWriter()
const zip = new ZipWriter(writer, { useWebWorkers: false })
const entries = new Map()
for (const name of ['background', 'content', 'protocol', 'request']) {
  const source = await readFile(`src/plugins/leetcode/connector/${name}.ts`, 'utf8')
  const result = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  })
  entries.set(`${name}.js`, result.outputText)
}
entries.set('manifest.json', await readFile('extension/leetcode/manifest.json', 'utf8'))
entries.set('README.md', await readFile('extension/leetcode/README.md', 'utf8'))
entries.set('LICENSE', await readFile('LICENSE', 'utf8'))
for (const [name, source] of entries) {
  await writeFile(`dist-connector/${name}`, source)
  await zip.add(name, new TextReader(source))
}
await zip.close()
await writeFile(
  'public/leetcode-connector.zip',
  new Uint8Array(await (await writer.getData()).arrayBuffer()),
)
