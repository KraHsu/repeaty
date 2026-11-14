import { expect, it } from 'vitest'
import {
  bundleSchema,
  installBundleSchema,
  manifestSchema,
  packageHash,
  pluginIssueMessage,
  readPluginFile,
  type PluginBundle,
} from './package'

function bundle(): PluginBundle {
  return {
    manifest: {
      id: 'example',
      name: 'Example',
      author: 'example-author',
      version: '1.2.3',
      apiVersion: 1,
      dataVersion: 1,
      kind: 'frontend',
      permissions: { origins: ['https://example.org'], secrets: true, files: false },
    },
    main: 'export default { id: "example" }',
    styles: '.example { color: green }',
  }
}

it('uses canonical object keys so native and browser trust refer to the same package content', async () => {
  const first = bundle()
  const reordered = {
    styles: first.styles,
    main: first.main,
    manifest: {
      permissions: { files: false, secrets: true, origins: ['https://example.org'] },
      kind: 'frontend',
      dataVersion: 1,
      apiVersion: 1,
      version: '1.2.3',
      name: 'Example',
      author: 'example-author',
      id: 'example',
    },
  } as PluginBundle
  expect(await packageHash(first)).toMatch(/^[0-9a-f]{64}$/)
  expect(await packageHash(reordered)).toBe(await packageHash(first))
  const { styles: _styles, ...withoutStyles } = first
  expect(await packageHash(withoutStyles)).toBe(await packageHash({ ...first, styles: '' }))
})

it('requires renewed trust when executable code, styles or declared capabilities change', async () => {
  const original = bundle(),
    hash = await packageHash(original)
  for (const changed of [
    { ...original, main: original.main + '\n// new code' },
    { ...original, styles: '.example { color: blue }' },
    { ...original, readme: '# Documentation\nRead before enabling.' },
    {
      ...original,
      manifest: { ...original.manifest, permissions: { origins: ['https://other.example'] } },
    },
    { ...original, manifest: { ...original.manifest, version: '1.2.4' } },
    { ...original, manifest: { ...original.manifest, author: 'another-author' } },
  ])
    expect(await packageHash(changed)).not.toBe(hash)
})

it('keeps installed legacy packages readable but requires an author on new installation', async () => {
  const legacy = bundle()
  delete legacy.manifest.author
  expect(bundleSchema.parse(legacy)).toEqual(legacy)
  expect(installBundleSchema.safeParse(legacy).success).toBe(false)
  await expect(
    readPluginFile(new File([JSON.stringify(legacy)], 'legacy.repeaty-plugin')),
  ).rejects.toThrow('作者（author）')
  expect(
    installBundleSchema.parse({
      ...legacy,
      manifest: { ...legacy.manifest, author: '  Example author  ' },
    }).manifest.author,
  ).toBe('Example author')
  for (const author of ['', '   ', 123, 'x'.repeat(101)]) {
    const result = installBundleSchema.safeParse({
      ...legacy,
      manifest: { ...legacy.manifest, author },
    })
    expect(result.success).toBe(false)
    if (!result.success) expect(pluginIssueMessage(result.error)).toContain('作者（author）')
  }
})

it('rejects paths and reserved core ids as plugin identifiers', () => {
  for (const id of [
    '',
    '../example',
    'a/b',
    'a\\b',
    'Uppercase',
    '_private',
    'a'.repeat(65),
    'flashcard',
    'unavailable',
  ])
    expect(manifestSchema.safeParse({ ...bundle().manifest, id }).success, id).toBe(false)
})

it('keeps package release versions separate from supported API and note data versions', () => {
  expect(
    manifestSchema.parse({ ...bundle().manifest, version: '9.8.7', dataVersion: 3 }),
  ).toMatchObject({
    version: '9.8.7',
    dataVersion: 3,
    apiVersion: 1,
  })
  for (const changed of [
    { apiVersion: 2 },
    { dataVersion: 0 },
    { dataVersion: 1001 },
    { version: 'latest' },
    { version: '1.2.3-dev_build' },
    { version: '1.2.3-' + 'a'.repeat(64) },
    { kind: 'executable' },
  ])
    expect(manifestSchema.safeParse({ ...bundle().manifest, ...changed }).success).toBe(false)
})

it('bounds executable and stylesheet UTF-8 bytes consistently with the native package reader', () => {
  const original = bundle()
  for (const changed of [
    { main: '' },
    { main: 'x'.repeat(4 * 1024 * 1024 + 1) },
    { main: '界'.repeat(Math.floor((4 * 1024 * 1024) / 3) + 1) },
    { styles: 'x'.repeat(1024 * 1024 + 1) },
    { styles: '界'.repeat(Math.floor((1024 * 1024) / 3) + 1) },
    { readme: 'x'.repeat(256 * 1024 + 1) },
    { readme: '界'.repeat(Math.floor((256 * 1024) / 3) + 1) },
  ])
    expect(bundleSchema.safeParse({ ...original, ...changed }).success).toBe(false)
})

it('preserves optional README bytes and binds documentation changes to exact package trust', async () => {
  const original = bundle()
  const readme = '# 使用说明\n\n**保留原文** 😀\n<script>not executable</script>\n'
  const documented = { ...original, readme }
  expect(bundleSchema.parse(documented).readme).toBe(readme)
  expect(
    await readPluginFile(new File([JSON.stringify(documented)], 'with-readme.repeaty-plugin')),
  ).toEqual(documented)
  expect(await packageHash(documented)).not.toBe(await packageHash(original))
  expect(await packageHash({ ...documented, readme: readme + '\nChanged' })).not.toBe(
    await packageHash(documented),
  )
  expect(await packageHash({ ...original, readme: '' })).not.toBe(await packageHash(original))
  expect(bundleSchema.safeParse({ ...original, readme: 123 }).success).toBe(false)
})

it('only accepts explicit HTTPS origins instead of URLs with paths or credentials', () => {
  expect(
    manifestSchema.safeParse({
      ...bundle().manifest,
      permissions: { origins: ['https://example.org', 'https://example.org'] },
    }).success,
  ).toBe(false)
  for (const origin of [
    'http://example.org',
    'https://user:pass@example.org',
    'https://example.org/path',
    'https://example.org/?query=1',
  ])
    expect(
      manifestSchema.safeParse({ ...bundle().manifest, permissions: { origins: [origin] } })
        .success,
    ).toBe(false)
})

it('parses an independent package file and rejects malformed or oversized containers before loading', async () => {
  expect(
    await readPluginFile(new File([JSON.stringify(bundle())], 'example.repeaty-plugin')),
  ).toEqual(bundle())
  await expect(readPluginFile(new File(['not JSON'], 'broken.repeaty-plugin'))).rejects.toThrow(
    '插件包格式或 API 版本不受支持。',
  )
  await expect(
    readPluginFile(new File(['x'.repeat(40 * 1024 * 1024 + 1)], 'oversized.repeaty-plugin')),
  ).rejects.toThrow('大小限制')
  await expect(
    readPluginFile(
      new File(
        [JSON.stringify({ ...bundle(), extra: 'unexpected entry' })],
        'extra.repeaty-plugin',
      ),
    ),
  ).rejects.toThrow()
})

it('explains native management failures while retaining a plugin-provided failure message', () => {
  expect(pluginIssueMessage('plugin-file-changed')).toContain('重新扫描')
  expect(pluginIssueMessage(new Error('permission-denied'))).toContain('权限')
  expect(pluginIssueMessage(new Error('Custom plugin failure'))).toBe('Custom plugin failure')
})

it('matches the native package hash golden fixture for Unicode and absent styles', async () => {
  // Shared with src-tauri/src/plugins/tests.rs; keep the payload and digest in sync.
  const value = bundleSchema.parse({
    manifest: {
      permissions: {
        files: true,
        secrets: false,
        origins: ['https://example.org', 'https://leetcode.cn'],
      },
      main: 'main.js',
      description: '代码与样式保持原字节\n第二行',
      kind: 'frontend',
      dataVersion: 3,
      apiVersion: 1,
      version: '2.3.4-beta.2',
      name: '  中文 😀  ',
      id: 'golden-example',
    },
    main: 'export default { text: "中文 😀" }\n',
  })
  expect(await packageHash(value)).toBe(
    'bfe649aa1c524811ec02555538e2b9eba94bd5013b53b7bcd051558a08e1a59c',
  )
  expect(await packageHash({ ...value, readme: '# 使用说明 😀\n\n保持原字节。\n' })).toBe(
    'f9183d1ef163549c51c471907707bb2a3b43105465c75726de0b4d55c889ec15',
  )
})
