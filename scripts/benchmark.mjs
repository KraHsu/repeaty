import { build } from 'vite'
import { chromium } from '@playwright/test'
import { createServer } from 'node:http'
import { mkdir, writeFile } from 'node:fs/promises'

const bundle = await build({
  configFile: false,
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'silent',
  build: {
    write: false,
    lib: { entry: 'scripts/scale-harness.ts', formats: ['iife'], name: 'RepeatyBenchmark' },
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
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  await page.addScriptTag({ content: code })
  const result = await page.evaluate(() => window.runScaleBenchmark())
  console.log(JSON.stringify(result, null, 2))
  await mkdir('test-results', { recursive: true })
  await writeFile('test-results/storage-benchmark.json', JSON.stringify(result, null, 2))
} finally {
  await browser.close()
  server.close()
}
