import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as vue from 'vue'
import { buildPlugin } from '../../../packages/plugin-api/build.mjs'
test('standalone package bundles its renderer/fonts and registers only through the public SDK', async () => {
  const out = await mkdtemp(join(tmpdir(), 'repeaty-visual-build-')),
    previous = globalThis.__REPEATY_PLUGIN_HOST__
  try {
    const bundle = await buildPlugin(fileURLToPath(new URL('..', import.meta.url)), { outdir: out })
    assert.doesNotMatch(bundle.main, /src\/application|src\/core|@nuxt\/ui|node:fs|indexedDB/)
    assert.match(bundle.styles, /data:font\/woff2;base64/)
    assert.doesNotMatch(bundle.styles, /https?:\/\/|url\(["']?katex\//)
    const importers = [],
      readers = [],
      commands = []
    const api = {
      registerImporter: (value) => importers.push(value),
      registerReader: (value) => readers.push(value),
      registerCommand: (value) => commands.push(value),
      materials: {},
      UiNotice: {},
      UiButton: {},
      SettingField: {},
    }
    globalThis.__REPEATY_PLUGIN_HOST__ = { vue, current: api }
    const module = await import(
        'data:text/javascript;base64,' + Buffer.from(bundle.main).toString('base64')
      ),
      plugin = module.default()
    assert.equal(plugin.id, 'visual-occlusion')
    assert.ok(plugin.editor)
    assert.ok(plugin.showQuestion)
    assert.ok(plugin.showAnswer)
    assert.deepEqual(
      readers.map((reader) => reader.id),
      ['image', 'formula'],
    )
    assert.deepEqual(
      commands.map((command) => command.formats),
      [['image'], ['markdown']],
    )
    assert.ok(commands.every((command) => command.component && !command.run))
    const bytes = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aY1sAAAAASUVORK5CYII=',
      'base64',
    )
    const file = new File([bytes], 'sample.png', { type: 'image/png' }),
      result = await importers[0].parse(file, {
        signal: new AbortController().signal,
        yield: async () => {},
      })
    assert.equal(result[0].readerId, 'image')
    assert.equal(result[0].text, 'sample.png')
    assert.ok(bundle.readme.includes('公式'))
  } finally {
    if (previous === undefined) delete globalThis.__REPEATY_PLUGIN_HOST__
    else globalThis.__REPEATY_PLUGIN_HOST__ = previous
    const suffix = relative(resolve(tmpdir()), resolve(out))
    assert.ok(!isAbsolute(suffix) && suffix.startsWith('repeaty-visual-build-'))
    await rm(out, { recursive: true, force: true })
  }
})
