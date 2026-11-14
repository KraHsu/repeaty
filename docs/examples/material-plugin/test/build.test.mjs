import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import * as vue from 'vue'
import { buildPlugin } from '../../../../packages/plugin-api/build.mjs'

test('builds an independent importer and reader without host source or a private storage path', async () => {
  const out = await mkdtemp(join(tmpdir(), 'repeaty-material-example-'))
  const previous = globalThis.__REPEATY_PLUGIN_HOST__
  try {
    const bundle = await buildPlugin(fileURLToPath(new URL('..', import.meta.url)), { outdir: out })
    assert.match(bundle.main, /__REPEATY_PLUGIN_HOST__/)
    assert.doesNotMatch(bundle.main, /src\/application|src\/core|@nuxt\/ui|node:fs|indexedDB/)
    assert.match(bundle.readme, /\.study\.json/)
    const importers = [],
      readers = [],
      commands = [],
      searchProviders = [],
      excerpts = []
    const source = {
      id: 'source',
      versionId: 'version',
      title: 'Chapter',
      format: 'plain',
      document: { providerId: 'structured-study-example', format: 'study-json' },
    }
    globalThis.__REPEATY_PLUGIN_HOST__ = {
      vue,
      current: {
        locale: vue.ref('zh-CN'),
        UiNotice: {},
        materials: {
          snapshot: () => ({ revision: 7, sources: [source] }),
          get: async () => ({ material: source, text: 'A hidden body keyword. More text.' }),
          createExcerpt: async (value) => {
            excerpts.push(value)
            return { sourceId: 'excerpt', revision: 8 }
          },
        },
        registerImporter(value) {
          importers.push(value)
          return () => {}
        },
        registerReader(value) {
          readers.push(value)
          return () => {}
        },
        registerCommand(value) {
          commands.push(value)
          return () => {}
        },
        registerSearchProvider(value) {
          searchProviders.push(value)
          return () => {}
        },
      },
    }
    const module = await import(
      'data:text/javascript;base64,' + Buffer.from(bundle.main).toString('base64')
    )
    const definition = module.default()
    assert.equal(definition.id, bundle.manifest.id)
    assert.equal(definition.type, 'extension')
    assert.equal(importers.length, 1)
    assert.equal(readers.length, 1)
    assert.equal(importers[0].id, 'study-json')
    assert.equal(readers[0].id, 'chapter')
    assert.deepEqual(readers[0].formats, ['study-json'])
    assert.equal(typeof readers[0].component.setup, 'function')
    assert.equal(commands[0].id, 'save-selection')
    assert.equal(searchProviders[0].id, 'chapters')
    const context = {
      signal: new AbortController().signal,
      yield: async () => {},
      progress: () => {},
      onCleanup: () => {},
    }
    const results = await searchProviders[0].search({ text: 'body keyword', limit: 5 }, context)
    assert.equal(results.hits.length, 1)
    assert.deepEqual(results.hits[0].locator, {
      schemaVersion: 1,
      sourceId: 'source',
      versionId: 'version',
      kind: 'text',
      start: 9,
      end: 21,
      quote: 'body keyword',
    })
    const selection = { text: 'body keyword', locator: results.hits[0].locator }
    await commands[0].run({
      ...context,
      sourceId: 'source',
      selection,
      expectedRevision: 7,
      operationId: 'from-host',
    })
    assert.deepEqual(excerpts, [
      {
        sourceId: 'source',
        selection,
        title: 'body keyword',
        expectedRevision: 7,
        operationId: 'from-host',
      },
    ])
  } finally {
    if (previous === undefined) delete globalThis.__REPEATY_PLUGIN_HOST__
    else globalThis.__REPEATY_PLUGIN_HOST__ = previous
    const suffix = relative(resolve(tmpdir()), resolve(out))
    assert.ok(!isAbsolute(suffix) && suffix.startsWith('repeaty-material-example-'))
    await rm(out, { recursive: true, force: true })
  }
})
