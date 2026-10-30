import { describe, expect, it } from 'vitest'
import { generateSite } from './generate'
import { defaultTheme } from './theme'
import { emptyIndex, type PublishSource } from './model'
import { renderTemplate } from './template'
const now = '2026-10-30T12:00:00Z'
const options = {
  title: '学习札记',
  description: '让知识互相连接',
  url: 'https://notes.example.com/study/',
  pageSize: 1,
}
const source = (id = 'private-source-1'): PublishSource => ({
  id,
  versionId: 'private-version-1',
  title: '间隔重复',
  text: '把记忆留给时间。',
  format: 'markdown',
  fields: [{ key: 'tags', values: ['学习', '记忆'] }],
  resources: [],
})
const input = (sources = [source()]) => ({
  sources,
  index: emptyIndex(),
  options,
  theme: defaultTheme(),
  now,
})
const contents = (result: Awaited<ReturnType<typeof generateSite>>, path: string) =>
  new TextDecoder().decode(result.files.find((item) => item.path === path)!.bytes)

describe('public site projection', () => {
  it('creates navigable pages, taxonomy, search, valid RSS and stable public paths without source identity', async () => {
    const first = source()
    const second = {
      ...source('private-source-2'),
      title: '主动回忆',
      text: '[[source:private-source-1|间隔重复]]',
      fields: [{ key: 'category', values: ['学习方法'] }],
    }
    const build = await generateSite(input([first, second]))
    expect(build.pages.map((item) => item.path)).toContain('page/2/index.html')
    expect(build.pages.map((item) => item.path)).toContain('search/index.html')
    expect(
      build.pages.some((item) => item.path.startsWith('tags/') && item.path !== 'tags/index.html'),
    ).toBe(true)
    expect(contents(build, 'articles/2/index.html')).toContain('../../articles/1/index.html')
    expect(contents(build, 'feed.xml')).toContain(
      'https://notes.example.com/study/articles/1/index.html',
    )
    const exported = build.files
      .filter((item) => item.type.includes('text') || item.type.includes('xml'))
      .map((item) => new TextDecoder().decode(item.bytes))
      .join('\n')
    expect(exported).not.toContain('private-source-')
    expect(exported).not.toContain('private-version-')
    expect(contents(build, 'search-index.js')).toContain('主动回忆')
    expect(build.fingerprint).toMatch(/^[a-f\d]{64}$/u)
  })
  it('preserves first publication and identity across changes, exclusion and republication', async () => {
    const first = await generateSite(input())
    const excluded = await generateSite({
      ...input([]),
      index: first.index,
      now: '2026-11-01T12:00:00Z',
    })
    expect(excluded.index.bindings[0]?.active).toBe(false)
    expect(excluded.files.some((item) => item.path.startsWith('articles/'))).toBe(false)
    const restored = await generateSite({
      ...input([{ ...source(), text: '新的文字', versionId: 'second' }]),
      index: excluded.index,
      now: '2026-11-02T12:00:00Z',
    })
    expect(restored.index.bindings[0]).toMatchObject({
      publicId: 1,
      publishedAt: now,
      updatedAt: '2026-11-02T12:00:00Z',
      active: true,
    })
    expect(first.index.bindings[0]).toMatchObject({ active: true, updatedAt: now })
  })
  it('projects heading links to public article anchors and deduplicates heading ids', async () => {
    const first = { ...source(), text: '# 核心 方法\n\n## 核心 方法' }
    const second = {
      ...source('second'),
      text: '[[source:private-source-1#核心 方法|相关段落]] [段落](repeaty-source:private-source-1#核心)',
      links: [
        {
          reference: 'repeaty-source:private-source-1#核心',
          sourceId: first.id,
          fragment: '核心 方法',
        },
      ],
    }
    const build = await generateSite(input([first, second]))
    expect(contents(build, 'articles/1/index.html')).toContain('id="核心-方法"')
    expect(contents(build, 'articles/1/index.html')).toContain('id="核心-方法-1"')
    expect(
      contents(build, 'articles/2/index.html').match(
        /articles\/1\/index.html#%E6%A0%B8%E5%BF%83-%E6%96%B9%E6%B3%95/gu,
      ),
    ).toHaveLength(2)
  })
  it('is deterministic for unchanged public content and does not change update dates on rebuild', async () => {
    const first = await generateSite(input())
    const again = await generateSite({
      ...input(),
      index: first.index,
      now: '2026-11-01T12:00:00Z',
    })
    expect(again.fingerprint).toBe(first.fingerprint)
    expect(again.index.bindings[0]?.updatedAt).toBe(now)
  })
  it('exports only explicitly projected resources, blocks unsafe HTML/links and renders code and math', async () => {
    const item = source()
    item.text =
      '<script>bad()</script><img src="file:///secret.png" onerror="bad()">\n\n![保留图](repeaty-resource:assets/a.png) [未知](repeaty-source:private-source-99)\n\n```js\nconst n = 1\n```\n\n$x^2$ **中文加粗**'
    item.resources.push({
      reference: 'repeaty-resource:assets/a.png',
      file: { path: 'assets/image.png', type: 'image/png', bytes: new Uint8Array([1, 2, 3]) },
    })
    const build = await generateSite(input([item]))
    const html = contents(build, 'articles/1/index.html')
    expect(html).toContain('../../assets/image.png')
    expect(html).not.toContain('bad()')
    expect(html).not.toContain('file:///')
    expect(html).not.toContain('repeaty-source:')
    expect(html).toContain('hljs-keyword')
    expect(html).toContain('<math ')
    expect(html).toContain('<strong>中文加粗</strong>')
  })
  it('rejects conflicting asset paths and oversized or corrupt data before replacing a build', async () => {
    await expect(
      generateSite(input([{ ...source(), text: '![远程图片](https://example.com/image.png)' }])),
    ).rejects.toThrow('外部图片或媒体')
    const a = source(),
      b = source('two')
    a.resources = [
      {
        reference: 'one',
        file: { path: 'assets/x.png', type: 'image/png', bytes: new Uint8Array([1]) },
      },
    ]
    b.resources = [
      {
        reference: 'two',
        file: { path: 'assets/x.png', type: 'image/png', bytes: new Uint8Array([2]) },
      },
    ]
    await expect(generateSite(input([a, b]))).rejects.toThrow('冲突')
    await expect(
      generateSite({
        ...input(),
        index: { version: 1, nextId: 1, bindings: [{ sourceId: 'x', publicId: 2 } as never] },
      }),
    ).rejects.toThrow('发布记录')
    await expect(
      generateSite({ ...input(), theme: { ...defaultTheme(), css: 'a'.repeat(256 * 1024 + 1) } }),
    ).rejects.toThrow('大小')
  })
})
describe('theme boundary', () => {
  it('escapes values, permits deliberate raw HTML and reports source locations', () => {
    expect(
      renderTemplate(
        '{{ page.title }} {{ page.content | raw }}',
        { page: { title: '<b>x</b>', content: '<strong>正文</strong>' } },
        'page.html',
      ),
    ).toBe('&lt;b&gt;x&lt;/b&gt; <strong>正文</strong>')
    expect(() => renderTemplate('a\n{{ private }}', {}, 'page.html')).toThrow(/page.html 第 2 行/u)
    expect(() =>
      renderTemplate('{{ page.title | wrong_filter }}', { page: { title: 'x' } }, 'page.html'),
    ).toThrow('wrong_filter')
  })
  it('denies files and prototype reads, with bounded rendering', () => {
    expect(() => renderTemplate('{% render "secret" %}', {}, 'page.html')).toThrow('引入')
    expect(() => renderTemplate('{{ page.constructor }}', { page: {} }, 'page.html')).toThrow()
    expect(() =>
      renderTemplate('{% for i in (1..999999999) %}x{% endfor %}', {}, 'page.html'),
    ).toThrow()
  })
})
