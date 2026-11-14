import test from 'node:test'
import assert from 'node:assert/strict'
import { Worker } from 'node:worker_threads'
import { buildPlugin } from '@repeaty/plugin-api/build.mjs'
import { fileURLToPath } from 'node:url'

test('independent package contains a self-contained parser that runs off-thread', async () => {
  const bundle = await buildPlugin(fileURLToPath(new URL('..', import.meta.url)))
  assert.equal(bundle.manifest.id, 'document-reader')
  assert.ok(bundle.main.includes('__repeatySdkContext_v1__'))
  assert.ok(bundle.readme.includes('99'))
  const asset = bundle.assets['document-worker.js']
  const source = Buffer.from(asset.base64, 'base64').toString('utf8')
  assert.ok(source.length > 1000)
  assert.ok(!/from\s*["'](?:\.\.?\/|@|node:)/.test(source))
  assert.ok(!bundle.main.includes('ZipReader'))
  const bootstrap = `import { parentPort } from 'node:worker_threads';
    globalThis.postMessage = message => parentPort.postMessage(message);
    await import(${JSON.stringify('data:text/javascript;base64,' + Buffer.from(source).toString('base64'))});
    parentPort.on('message', data => globalThis.onmessage({data}));`
  const worker = new Worker(
    new URL('data:text/javascript;base64,' + Buffer.from(bootstrap).toString('base64')),
  )
  try {
    const result = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('parser worker timed out')), 10000)
      worker.on('error', (error) => {
        clearTimeout(timeout)
        reject(error)
      })
      worker.on('message', (message) => {
        if (message.type === 'done') {
          clearTimeout(timeout)
          resolve(message.book)
        }
        if (message.type === 'error') {
          clearTimeout(timeout)
          reject(new Error(message.message))
        }
      })
      worker.postMessage({
        kind: 'html',
        bytes: new TextEncoder().encode(
          '<title>后台</title><p>中文😀<b>精确选区</b></p><script>throw Error("unsafe")</script>',
        ),
        path: 'index.html',
        related: [],
      })
    })
    assert.equal(result.title, '后台')
    assert.equal(result.chapters[0].text, '中文😀精确选区\n')
    assert.ok(!result.chapters[0].html.includes('unsafe'))
  } finally {
    await worker.terminate()
  }
})
