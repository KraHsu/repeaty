#!/usr/bin/env node
import { build } from 'vite'
import vue from '@vitejs/plugin-vue'
import * as sharedVue from 'vue'
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { watch } from 'node:fs'
import { parseArgs } from 'node:util'

const runtimeExports = [
  't',
  'locale',
  'readSetting',
  'writeSetting',
  'registerSettings',
  'practiceContentRevision',
  'hasAttemptBody',
  'MediaList',
  'CardContent',
  'PracticeHistory',
  'AttemptBody',
  'SettingGroup',
  'SettingSection',
  'SettingField',
  'UiButton',
  'UiIconButton',
  'UiNotice',
  'UiStatus',
  'vUiControl',
  'vUiButton',
  'pluginData',
  'nativePlugin',
  'onDispose',
  'pluginFiles',
]
export async function buildPlugin(directory, { outdir } = {}) {
  directory = resolve(directory)
  const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'))
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(manifest.id) || manifest.apiVersion !== 1)
    throw new Error('Invalid plugin manifest')
  let readme
  try {
    const bytes = await readFile(join(directory, 'README.md'))
    if (bytes.length > 256 * 1024)
      throw new Error('Plugin README exceeds the 256 KiB host package limit')
    readme = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  const sdk = '\0repeaty-public-plugin-sdk'
  const vueRuntime = '\0repeaty-shared-vue'
  const output = await build({
    configFile: false,
    root: directory,
    plugins: [
      {
        name: 'repeaty-public-sdk',
        enforce: 'pre',
        resolveId(id) {
          if (id === '@repeaty/plugin-api') return sdk
          if (id === 'vue') return vueRuntime
        },
        load(id) {
          if (id === sdk)
            return (
              'const api = __repeatySdkContext_v1__;\n' +
              runtimeExports.map((name) => `export const ${name} = api.${name};`).join('\n')
            )
          if (id === vueRuntime)
            return Object.keys(sharedVue)
              .filter((name) => /^[a-zA-Z_$][\w$]*$/.test(name) && name !== 'default')
              .map(
                (name) => `export const ${name} = globalThis.__REPEATY_PLUGIN_HOST__.vue.${name};`,
              )
              .join('\n')
        },
      },
      vue(),
    ],
    define: { 'process.env.NODE_ENV': '"production"' },
    build: {
      write: false,
      target: 'es2022',
      lib: { entry: join(directory, 'src/index.ts'), formats: ['es'], fileName: 'main' },
      rolldownOptions: { output: { inlineDynamicImports: true, codeSplitting: false } },
      cssCodeSplit: false,
      minify: true,
    },
  })
  const files = (Array.isArray(output) ? output[0] : output).output
  const code = files.find((file) => file.type === 'chunk' && file.isEntry)?.code
  if (!code) throw new Error('Missing plugin entry')
  // Lazy Vue components must retain their own SDK after module evaluation finishes.
  const main =
    'const __repeatySdkContext_v1__ = globalThis.__REPEATY_PLUGIN_HOST__.current;\n' +
    code +
    `\n//# sourceURL=repeaty-plugin://${manifest.id}/${manifest.version}/main.js\n`
  const styles = files
    .filter((file) => file.type === 'asset' && file.fileName.endsWith('.css'))
    .map((file) => String(file.source))
    .join('\n')
  const bundle = { manifest, main, styles, ...(readme === undefined ? {} : { readme }) }
  if (Buffer.byteLength(main) > 4 * 1024 * 1024 || Buffer.byteLength(styles) > 1024 * 1024)
    throw new Error('Plugin code or CSS exceeds the host package limit')
  const out = outdir ? resolve(outdir) : join(directory, 'dist')
  await mkdir(out, { recursive: true })
  await Promise.all([
    writeFile(join(out, 'main.js'), main),
    writeFile(join(out, 'styles.css'), styles),
    writeFile(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n'),
    writeFile(join(out, manifest.id + '.repeaty-plugin'), JSON.stringify(bundle) + '\n'),
    readme === undefined
      ? rm(join(out, 'README.md'), { force: true })
      : writeFile(join(out, 'README.md'), readme),
  ])
  return bundle
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      watch: { type: 'boolean', default: false },
      outdir: { type: 'string' },
    },
  })
  const directory = resolve(positionals[0] ?? '.')
  const build = () => buildPlugin(directory, { outdir: values.outdir })
  if (!values.watch) await build()
  else {
    let running = false,
      dirty = false,
      timer
    const rebuild = async () => {
      if (running) {
        dirty = true
        return
      }
      running = true
      do {
        dirty = false
        try {
          await build()
          console.log('Plugin built. Rescan or reload it in Repeaty.')
        } catch (error) {
          console.error(error instanceof Error ? error.message : error)
        }
      } while (dirty)
      running = false
    }
    const schedule = () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        void rebuild()
      }, 150)
    }
    const watchers = [
      watch(join(directory, 'src'), { recursive: true }, schedule),
      watch(directory, (_event, name) => {
        if (['manifest.json', 'README.md'].includes(String(name))) schedule()
      }),
    ]
    const stop = () => {
      clearTimeout(timer)
      for (const watcher of watchers) watcher.close()
    }
    process.once('SIGINT', () => {
      stop()
      process.exit(0)
    })
    process.once('SIGTERM', () => {
      stop()
      process.exit(0)
    })
    await rebuild()
  }
}
