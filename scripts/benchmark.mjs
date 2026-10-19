import { build } from 'vite'
import { chromium } from '@playwright/test'
import { createServer } from 'node:http'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { cpus, platform, release } from 'node:os'
import { parseArgs } from 'node:util'
import vue from '@vitejs/plugin-vue'

const { values } = parseArgs({
  options: {
    history: { type: 'boolean', default: false },
    output: { type: 'string' },
  },
})

const bundle = await build({
  configFile: false,
  define: {
    'process.env.NODE_ENV': '"production"',
    __REPEATY_EDITION__: '"static"',
  },
  plugins: values.history ? [vue()] : [],
  resolve: { alias: { '@repeaty-plugins': resolve('repeaty.plugins.static.ts') } },
  logLevel: 'silent',
  build: {
    write: false,
    lib: {
      entry: values.history ? 'scripts/history-harness.ts' : 'scripts/scale-harness.ts',
      formats: ['iife'],
      name: 'RepeatyBenchmark',
    },
    rolldownOptions: { output: { inlineDynamicImports: true } },
    minify: true,
  },
})
const code = (Array.isArray(bundle) ? bundle[0] : bundle).output.find(
  (entry) => entry.type === 'chunk',
).code
const server = createServer((_req, res) => {
  res.setHeader('Content-Type', 'text/html')
  res.end('<!doctype html><title>Repeaty storage benchmark</title>')
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const browser = await chromium.launch({ args: ['--enable-precise-memory-info'] })
try {
  const page = await browser.newPage()
  page.on('pageerror', (error) => console.error(error))
  page.on('console', (message) => {
    if (message.text().startsWith('benchmark:')) console.error(message.text())
  })
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  await page.addScriptTag({ content: code })
  const measurement = await page.evaluate(() => window.runScaleBenchmark())
  const result = {
    environment: {
      os: `${platform()} ${release()}`,
      cpu: cpus()[0]?.model,
      browser: browser.version(),
      node: process.version,
    },
    ...measurement,
  }
  console.log(JSON.stringify(result, null, 2))
  const output =
    values.output ?? `test-results/${values.history ? 'history' : 'storage'}-benchmark.json`
  await mkdir(dirname(output), { recursive: true })
  await writeFile(output, JSON.stringify(result, null, 2) + '\n')
} finally {
  await browser.close()
  server.close()
}
