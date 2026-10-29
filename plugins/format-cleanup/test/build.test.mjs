import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as vue from 'vue'
import { buildPlugin } from '../../../packages/plugin-api/build.mjs'

test('standalone package previews in its serialized worker and confirms through the public transaction', async () => {
  const out = await mkdtemp(join(tmpdir(), 'repeaty-cleanup-build-'))
  const previous = globalThis.__REPEATY_PLUGIN_HOST__
  const warnings = console.warn
  try {
    const bundle = await buildPlugin(fileURLToPath(new URL('..', import.meta.url)), { outdir: out })
    assert.doesNotMatch(bundle.main, /src\/application|src\/core|@nuxt\/ui|node:fs|indexedDB/)
    const pages = [],
      settings = [],
      edits = [],
      workerSources = []
    const source = { id: 'source', versionId: 'original', title: 'test', format: 'markdown' }
    const api = {
      locale: vue.ref('zh-CN'),
      readSetting: () =>
        JSON.stringify({ rules: [{ kind: 'literal', find: 'foo', replace: 'bar' }] }),
      writeSetting: () => {},
      registerPage: (value) => pages.push(value),
      registerSettings: (value) => settings.push(value),
      AppPage: { name: 'AppPage' },
      UiButton: { name: 'UiButton' },
      UiTextarea: {},
      SettingField: {},
      UiNotice: {},
      SettingSection: {},
      materials: {
        snapshot: () => ({ workspaceScope: 'scope', revision: 3, sources: [source], decks: [] }),
        get: async () => ({ material: source, text: 'foo `foo`' }),
        editContent: async (request) => edits.push(request),
      },
      tasks: {
        run: async (_options, work) => {
          const cleanups = []
          try {
            return await work({
              signal: new AbortController().signal,
              onCleanup: (stop) => cleanups.push(stop),
              createWorker: (script) => {
                workerSources.push(script)
                const worker = {
                  onmessage: null,
                  onerror: null,
                  terminate() {},
                  postMessage(data) {
                    queueMicrotask(() => self.onmessage({ data }))
                  },
                }
                const self = {
                  postMessage(data) {
                    worker.onmessage({ data })
                  },
                }
                runInNewContext(script, { self })
                return worker
              },
            })
          } finally {
            cleanups.forEach((stop) => stop())
          }
        },
      },
    }
    const mounted = []
    globalThis.__REPEATY_PLUGIN_HOST__ = {
      vue: { ...vue, onMounted: (callback) => mounted.push(callback), onBeforeUnmount: () => {} },
      current: api,
    }
    const module = await import(
      'data:text/javascript;base64,' + Buffer.from(bundle.main).toString('base64')
    )
    assert.equal(module.default().id, 'format-cleanup')
    assert.equal(pages.length, 1)
    assert.equal(settings.length, 1)
    assert.equal(settings[0].category[0].id, 'tools')
    // Inspect compiled render event handlers without mounting a native window.
    console.warn = () => {}
    const child = pages[0].component.setup({ workspaceScope: 'scope' })()
    const render = child.type.setup(child.props, { expose() {} })
    for (const mount of mounted) await mount()
    await vue.nextTick()
    const page = () => render({}, [])
    const action = page().children.actions()
    await action[0].props.onClick()
    assert.equal(workerSources.length, 1)
    assert.equal(edits.length, 0)
    function flatten(value) {
      return [value, ...(Array.isArray(value?.children) ? value.children.flatMap(flatten) : [])]
    }
    const nodes = page().children.default().flatMap(flatten)
    const apply = nodes.find(
      (node) =>
        node?.type === api.UiButton && node.children?.default?.()[0]?.children === '应用清理',
    )
    assert.ok(apply, 'preview exposes explicit apply control')
    await apply.props.onClick()
    assert.equal(edits.length, 1)
    assert.deepEqual(
      { ...edits[0], operationId: 'id' },
      {
        sourceId: 'source',
        versionId: 'original',
        content: 'bar `foo`',
        expectedRevision: 3,
        operationId: 'id',
      },
    )
  } finally {
    console.warn = warnings
    if (previous === undefined) delete globalThis.__REPEATY_PLUGIN_HOST__
    else globalThis.__REPEATY_PLUGIN_HOST__ = previous
    const suffix = relative(resolve(tmpdir()), resolve(out))
    assert.ok(!isAbsolute(suffix) && suffix.startsWith('repeaty-cleanup-build-'))
    await rm(out, { recursive: true, force: true })
  }
})
