import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { createServer } from 'vite'

const output = fileURLToPath(
  new URL(
    '../../../docs/local-plans.local/foliole-coverage-2026-10-29/p6/optimizer-browser/',
    import.meta.url,
  ),
)
await mkdir(output, { recursive: true })
const server = await createServer({
  configFile: fileURLToPath(new URL('./vite.config.ts', import.meta.url)),
})
await server.listen()
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
})
const page = await browser.newPage()
const errors = [],
  remote = []
page.on('pageerror', (error) => errors.push(error.message))
page.on('request', (request) => {
  if (/^https?:/.test(request.url()) && !request.url().startsWith('http://127.0.0.1:4199/'))
    remote.push(request.url())
})
try {
  await page.goto('http://127.0.0.1:4199/test/harness.html')
  await page.waitForFunction(() => !!window.optimizerTest)
  const isolated = await page.evaluate(() => crossOriginIsolated)
  assert.equal(isolated, false, 'must work without COOP/COEP or SharedArrayBuffer')
  const result = await page.evaluate(() => window.optimizerTest.train())
  assert.ok(result.weights, JSON.stringify(result))
  assert.equal(result.weights.length, 21)
  assert.ok(result.weights.every(Number.isFinite))
  assert.ok(result.pulses > 1, 'main thread remains responsive during WASM work')
  assert.deepEqual(await page.evaluate(() => window.optimizerTest.active), { workers: 0, urls: 0 })
  const cancelled = []
  for (const kind of ['caller', 'scope']) {
    await page.evaluate(() => window.optimizerTest.initialize())
    const value = await page.evaluate((kind) => window.optimizerTest.train(kind), kind)
    assert.equal(value.cancelled, true)
    assert.deepEqual(await page.evaluate(() => window.optimizerTest.active), {
      workers: 0,
      urls: 0,
    })
    cancelled.push({ kind, ...value })
  }
  assert.deepEqual(errors, [])
  assert.deepEqual(remote, [])
  const evidence = {
    browser: await browser.version(),
    crossOriginIsolated: isolated,
    result,
    cancelled,
    errors,
    remote,
  }
  await writeFile(`${output}/worker.json`, JSON.stringify(evidence, null, 2))
  console.log(JSON.stringify(evidence))
} finally {
  await browser.close()
  await server.close()
}
