import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildPlugin } from './build.mjs'

const fixtureRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../test-results/plugin-readme-build',
)
const projects = []
async function project() {
  await mkdir(fixtureRoot, { recursive: true })
  const directory = await mkdtemp(join(fixtureRoot, 'project-'))
  projects.push(directory)
  await mkdir(join(directory, 'src'))
  await writeFile(
    join(directory, 'manifest.json'),
    JSON.stringify({
      id: 'readme-example',
      name: 'README example',
      version: '1.0.0',
      apiVersion: 1,
      dataVersion: 1,
      kind: 'frontend',
    }),
  )
  await writeFile(join(directory, 'src/index.ts'), 'export default { id: "readme-example" }\n')
  return directory
}
afterEach(async () => {
  for (const directory of projects.splice(0)) {
    const suffix = relative(fixtureRoot, directory)
    assert.ok(
      suffix &&
        !isAbsolute(suffix) &&
        suffix !== '..' &&
        !suffix.startsWith('../') &&
        !suffix.startsWith('..\\'),
    )
    await rm(directory, { recursive: true, force: true })
  }
})

test('independent builds include original README bytes and remove a stale output when documentation is removed', async () => {
  const directory = await project()
  const readme = '\uFEFF# 插件说明 😀\r\n\r\n**保留原文**\r\n'
  await writeFile(join(directory, 'README.md'), readme)
  const bundle = await buildPlugin(directory)
  assert.equal(bundle.readme, readme)
  assert.equal(await readFile(join(directory, 'dist/README.md'), 'utf8'), readme)
  assert.equal(
    JSON.parse(await readFile(join(directory, 'dist/readme-example.repeaty-plugin'), 'utf8'))
      .readme,
    readme,
  )
  await rm(join(directory, 'README.md'))
  const without = await buildPlugin(directory)
  assert.equal(Object.hasOwn(without, 'readme'), false)
  await assert.rejects(readFile(join(directory, 'dist/README.md')), { code: 'ENOENT' })
})

test('README limits apply to UTF-8 bytes before an independent plugin is compiled', async () => {
  const directory = await project()
  for (const readme of [
    'x'.repeat(256 * 1024 + 1),
    '界'.repeat(Math.floor((256 * 1024) / 3) + 1),
  ]) {
    await writeFile(join(directory, 'README.md'), readme)
    await assert.rejects(buildPlugin(directory), /README exceeds the 256 KiB/)
    await assert.rejects(readFile(join(directory, 'dist/main.js')), { code: 'ENOENT' })
  }
})

test('non-UTF-8 README files are rejected instead of silently replacing bytes', async () => {
  const directory = await project()
  await writeFile(join(directory, 'README.md'), Buffer.from([0xc3, 0x28]))
  await assert.rejects(buildPlugin(directory), /encoded data was not valid/)
})

test('public controls compile as host references without bundling a UI or Vue runtime', async () => {
  const directory = await project()
  const controls = [
    'UiInput',
    'UiTextarea',
    'UiSelect',
    'UiCheckbox',
    'UiProgress',
    'UiCollapsible',
  ]
  await writeFile(
    join(directory, 'src/index.ts'),
    `import { h } from 'vue'\n` +
      `import { ${controls.join(', ')} } from '@repeaty/plugin-api'\n` +
      `export default { controls: [${controls.join(', ')}], render: () => h(UiInput) }\n`,
  )
  const { main } = await buildPlugin(directory)
  assert.match(main, /__REPEATY_PLUGIN_HOST__\.vue/)
  assert.doesNotMatch(main, /@nuxt\/ui|reka-ui|__VUE_OPTIONS_API__|nuxt-ui\.form-options/)
  const current = Object.fromEntries(controls.map((name) => [name, { name }]))
  const previous = globalThis.__REPEATY_PLUGIN_HOST__
  globalThis.__REPEATY_PLUGIN_HOST__ = { current, vue: { h: (component) => component } }
  try {
    const { default: plugin } = await import(
      'data:text/javascript;base64,' + Buffer.from(main).toString('base64')
    )
    assert.deepEqual(
      plugin.controls,
      controls.map((name) => current[name]),
    )
    assert.equal(plugin.render(), current.UiInput)
  } finally {
    if (previous === undefined) delete globalThis.__REPEATY_PLUGIN_HOST__
    else globalThis.__REPEATY_PLUGIN_HOST__ = previous
  }
})
