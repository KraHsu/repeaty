import { describe, expect, it } from 'vitest'
import { parseEpub, parseHtml } from './parse'
import { cleanHtml } from './html'
import { candidates } from './import'
import { cleanPath, resolvePath } from './path'
import { archive, epubFiles, pixel } from '../test/fixtures'

describe('EPUB imports', () => {
  it('keeps image-only covers and non-linear spine chapters without placing the cover in the study sequence', async () => {
    const files = epubFiles()
    files['OPS/chapter1.xhtml'] =
      '<html><head><title>封面</title></head><body><img src="images/pixel.png" alt="封面图"/></body></html>'
    files['OPS/book.opf'] = String(files['OPS/book.opf']).replace(
      'idref="a"',
      'idref="a" linear="no"',
    )
    const book = await parseEpub(await archive(files), 'cover.epub'),
      imported = candidates(book, 'sequential')
    expect(book.chapters).toHaveLength(2)
    expect(book.chapters[0]!.html).toContain('data-doc-resource')
    expect(book.chapters[0]!.text).toBe('[图片 / 音频文档：封面]')
    expect(imported[1]!.container).toBe(true)
    expect(imported[1]!.studySequence).toBeUndefined()
    expect(imported[2]!.studySequence?.index).toBe(1)
  })
  it.each([2, 3] as const)(
    'retains EPUB %i spine, directory, offline images and source identity',
    async (version) => {
      const book = await parseEpub(await archive(epubFiles(version)), 'book.epub')
      expect(book.title).toBe('绿色阅读书')
      expect(book.chapters.map((chapter) => chapter.title)).toEqual(['第一章', '第二章'])
      expect(book.toc.map((item) => [item.title, item.path, item.fragment])).toEqual([
        ['第一章 · 学习', 'OPS/chapter1.xhtml', 'start'],
        ['第二章 · 回答', 'OPS/chapter2.xhtml', 'answer'],
      ])
      expect(book.chapters[0]!.html).toContain('data-doc-resource="OPS/images/pixel.png"')
      expect(book.chapters[0]!.html).not.toContain('script')
      expect(book.chapters[0]!.text).toContain('中文强调😀重复文本。重复文本。')
      expect(book.resources[0]!.bytes).toEqual(pixel)
      const free = candidates(book, 'free'),
        sequential = candidates(book, 'sequential')
      expect(free.map((item) => item.key)).toEqual(sequential.map((item) => item.key))
      expect(sequential[0]!.container).toBe(true)
      expect(sequential[1]!.studySequence).toEqual({
        groupKey: 'book',
        index: 0,
        mode: 'sequential',
      })
      expect(sequential[2]!.documentPath).toBe('OPS/chapter2.xhtml')
      expect(sequential[1]!.resources?.[0]?.blob.size).toBe(pixel.length)
    },
  )
  it('rejects malformed archives, traversal, encryption markers and missing chapters', async () => {
    await expect(parseEpub(new Uint8Array([1, 2, 3]), 'bad.epub')).rejects.toThrow()
    await expect(
      parseEpub(await archive({ ...epubFiles(), '../escape.png': pixel }), 'bad.epub'),
    ).rejects.toThrow()
    await expect(
      parseEpub(
        await archive({ ...epubFiles(), 'META-INF/encryption.xml': '<encryption/>' }),
        'bad.epub',
      ),
    ).rejects.toThrow('加密')
    const files = epubFiles()
    delete files['OPS/chapter2.xhtml']
    await expect(parseEpub(await archive(files), 'bad.epub')).rejects.toThrow('缺少')
  })
  it('observes cancellation before decoding', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      parseEpub(await archive(epubFiles()), 'book.epub', { signal: controller.signal }),
    ).rejects.toThrow()
  })
})
describe('HTML imports', () => {
  it('keeps semantic content, safe style, exact UTF-16 text, source URL and selected local resources', async () => {
    const text =
      '<head><link rel="canonical" href="https://example.com/article"/><title>Article</title></head><body><h1>中文😀</h1><p style="text-align:center;color:red;background:url(https://evil.invalid)">第二<strong>段</strong></p><img src="images/pixel.png" onerror="evil()"/><a href="#target">内部链接</a><p id="target">终点</p></body>'
    const book = await parseHtml(new TextEncoder().encode(text), 'page/index.html', [
      { path: 'page/images/pixel.png', bytes: pixel, type: 'image/png' },
    ])
    expect(book.url).toBe('https://example.com/article')
    expect(book.chapters[0]!.text).toContain('中文😀\n第二段')
    expect(book.chapters[0]!.html).toContain('style="text-align:center"')
    expect(book.chapters[0]!.html).not.toMatch(/onerror|background|color:/)
    expect(book.chapters[0]!.anchors.target).toBeGreaterThan(0)
    expect(book.resources[0]!.bytes).toEqual(pixel)
  })
  it('drops active/hidden content, network media, CSS URLs, unsafe protocols and SVG', () => {
    const result = cleanHtml(
      '<body>安全<script>alert(1)</script><iframe src="https://evil.invalid">iframe</iframe><svg onload="evil()"><text>svg</text></svg><p hidden>hidden</p><p style="display:none">invisible</p><a href="javascript:evil()">链接</a><img src="https://evil.invalid/track.png" alt="未下载"/><math><mi>x</mi><mo>+</mo><mn>2</mn><annotation>bad latex duplicate</annotation></math></body>',
      'index.html',
      new Set(),
      'title',
    )
    expect(result.chapter.html).not.toMatch(
      /script|iframe|svg|onload|javascript|src=|hidden|invisible|bad latex/,
    )
    expect(result.chapter.html).toContain('<math><mi>x</mi><mo>+</mo><mn>2</mn></math>')
    expect(result.chapter.text).toBe('安全链接[未下载]x+2')
    expect(result.missing).toEqual(['https://evil.invalid/track.png'])
  })
  it('keeps embedded images with distinct paths in different chapters', () => {
    const html = `<p>image</p><img src="data:image/png;base64,${btoa(String.fromCharCode(...pixel))}">`
    const a = cleanHtml(html, 'a.html', new Set(), 'a'),
      b = cleanHtml(html, 'b.html', new Set(), 'b')
    expect(a.embedded[0]!.path).not.toBe(b.embedded[0]!.path)
    expect(a.embedded[0]!.bytes).toEqual(pixel)
  })
  it('resolves resources from a separately chosen HTML companion directory', async () => {
    const book = await parseHtml(
      new TextEncoder().encode('<p>内容</p><img src="images/a.png"/>'),
      'index.html',
      [{ path: 'chosen-folder/images/a.png', bytes: pixel, type: 'image/png' }],
    )
    expect(book.warnings).toEqual([])
    expect(book.resources.map((item) => item.path)).toEqual(['images/a.png'])
    expect(book.resources[0]!.bytes).toEqual(pixel)
  })
  it('rejects ambiguous paths and excessive text', () => {
    for (const path of ['../x', '/x', 'C:/x', 'a\\b', 'a/../b'])
      expect(() => cleanPath(path)).toThrow()
    for (const href of [
      '../../outside',
      'file:///x',
      'javascript:x',
      '%2e%2e/%2e%2e/x',
      'https://example.com',
    ])
      expect(resolvePath('book/a.html', href)).toBeUndefined()
    expect(resolvePath('book/a.html', '../b.html#hello%20world')).toEqual({
      path: 'b.html',
      fragment: 'hello world',
    })
    expect(() => cleanHtml(`<p>${'x'.repeat(250001)}</p>`, 'a.html', new Set(), 'a')).toThrow(
      '250,000',
    )
  })
})
