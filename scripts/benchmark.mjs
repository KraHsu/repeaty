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
    runs: { type: 'string', default: '1' },
  },
})
const runs = Number(values.runs)
if (!Number.isSafeInteger(runs) || runs < 1 || runs > 10) throw new Error('--runs must be 1–10')

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
const browser = await chromium.launch({
  args: ['--enable-precise-memory-info', '--js-flags=--expose-gc'],
})
try {
  const samples = []
  for (let i = 0; i < runs; i++) {
    const context = await browser.newContext()
    const page = await context.newPage()
    page.on('pageerror', (error) => console.error(error))
    page.on('console', (message) => {
      if (message.text().startsWith('benchmark:')) console.error(message.text())
    })
    await page.goto(`http://127.0.0.1:${server.address().port}`)
    await page.addScriptTag({ content: code })
    let prepared
    if (values.history) {
      prepared = await page.evaluate(() => window.prepareHistoryBenchmark())
      // Drop the generator's objects and heap before measuring a real reopen.
      await page.reload()
      await page.addScriptTag({ content: code })
    }
    samples.push(await page.evaluate((prepared) => window.runScaleBenchmark(prepared), prepared))
    await context.close()
  }
  const median = Object.fromEntries(
    Object.keys(samples[0])
      .filter((key) => typeof samples[0][key] === 'number')
      .map((key) => {
        const ordered = samples.map((sample) => sample[key]).sort((a, b) => a - b)
        const middle = Math.floor(ordered.length / 2)
        return [
          key,
          ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2,
        ]
      }),
  )
  const result = {
    environment: {
      os: `${platform()} ${release()}`,
      cpu: cpus()[0]?.model,
      browser: browser.version(),
      node: process.version,
    },
    ...(runs === 1 ? samples[0] : { runs, median, samples }),
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
