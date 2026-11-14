import { expect, it } from 'vitest'
import { convertReadwise, htmlToMarkdown } from './content'
import { scanExportDirectory } from './directory'
it('returns HTTPS original references without fetching them or persisting authorization', () => {
  const result = convertReadwise(
    [
      {
        id: 'book',
        category: 'epub',
        title: 'Book',
        raw_source_url: 'https://bucket.s3.amazonaws.com/book.epub?signature=temporary',
      },
    ],
    [],
  )
  expect(result.items[0]?.original).toEqual({
    url: 'https://bucket.s3.amazonaws.com/book.epub?signature=temporary',
    name: 'Book.epub',
    format: 'epub',
  })
  expect(result.items[0]?.text).toContain('获取原件')
  expect(() =>
    convertReadwise(
      [{ id: 'bad', category: 'epub', title: 'Bad', raw_source_url: 'http://localhost/file' }],
      [],
    ),
  ).toThrow('未提供')
})
it('keeps headings, inline formatting and inert links without executing remote HTML', () => {
  const text = htmlToMarkdown(
    '<h1>中文标题</h1><p>Hello <b>world</b> <a href="javascript:evil()">bad</a></p><script>evil()</script><img src="https://tracker.test" alt="插图"><pre><code>x &lt; 1</code></pre>',
  )
  expect(text).toContain('# 中文标题')
  expect(text).toContain('**world**')
  expect(text).toContain('```\nx < 1\n```')
  expect(text).not.toMatch(/script|evil|tracker/)
})
it('maps independent books, Reader body/highlights, tombstones and deleted highlights', () => {
  const result = convertReadwise(
    [
      { id: 'one', title: 'One', html_content: '<p>Original</p>' },
      { id: 'h1', parent_id: 'one', html_content: '<p>Quote</p>', notes: 'Note' },
    ],
    [
      {
        user_book_id: 1,
        source: 'reader',
        external_id: 'one',
        highlights: [{ text: 'Duplicate quote' }],
      },
      {
        user_book_id: 2,
        title: 'Book',
        highlights: [{ text: 'Keep' }, { text: 'Gone', is_deleted: true }],
      },
      { user_book_id: 3, is_deleted: true },
    ],
  )
  expect(result.items).toHaveLength(2)
  expect(result.items.find((item) => item.key === 'reader:one')?.text).toBe(
    'Original\n\n## 高亮\n\n> Quote\nNote',
  )
  expect(result.items.find((item) => item.key === 'book:2')?.text).toBe('> Keep')
  expect(result.deletedKeys).toEqual(['book:3'])
})
it('pairs standard Readwise full documents and highlights without duplicate materials', async () => {
  const content: Record<string, string> = {
    'Books/A.md': '# A\n\n## Highlights\nQuote.',
    'Full Document Contents/Books/A.md': '# A\n\n## Full Document\nFull body.',
    '.obsidian/private.md': 'private',
  }
  const directory = {
    files: Object.entries(content).map(([path, text]) => ({ path, size: text.length })),
    read: async (path: string) => new Blob([content[path]!]),
  }
  const context = { signal: new AbortController().signal, progress() {}, async yield() {} }
  const result = await scanExportDirectory(directory, context)
  expect(result.items).toHaveLength(1)
  expect(result.items[0]?.key).toBe('export:Books/A')
  expect(result.items[0]?.text).toContain('Full body.')
  expect(result.items[0]?.text).toContain('Quote.')
  expect(result.complete).toBe(true)
})
it('uses source IDs across filename changes and rejects conflicting duplicate exports', async () => {
  const content = '---\nreader_id: stable\ntitle: Test\n---\nBody'
  const context = { signal: new AbortController().signal, progress() {}, async yield() {} }
  const result = await scanExportDirectory(
    {
      files: [{ path: 'renamed.md', size: content.length }],
      read: async () => new Blob([content]),
    },
    context,
  )
  expect(result.items[0]?.key).toBe('reader:stable')
  await expect(
    scanExportDirectory(
      {
        files: [
          { path: 'A.md', size: 1 },
          { path: 'B.md', size: 1 },
        ],
        read: async () => new Blob([content]),
      },
      context,
    ),
  ).rejects.toThrow('同一来源')
})
it('pairs local EPUB originals with accepted source identity without reading or modifying original bytes', async () => {
  const content = '---\nreader_id: stable\n---\n# Book\nFull text'
  const reads: string[] = []
  const result = await scanExportDirectory(
    {
      files: [
        { path: 'Full Document Contents/Books/Book.md', size: content.length },
        { path: 'Full Document Contents/Books/Book.epub', size: 32 },
      ],
      read: async (path) => {
        reads.push(path)
        return new Blob([content])
      },
    },
    { signal: new AbortController().signal, progress() {}, async yield() {} },
  )
  expect(result.items).toHaveLength(1)
  expect(result.items[0]).toMatchObject({
    key: 'reader:stable',
    original: { path: 'Full Document Contents/Books/Book.epub', name: 'Book.epub', format: 'epub' },
  })
  expect(reads).toEqual(['Full Document Contents/Books/Book.md'])
})
it('bounds remote and directory titles to the host limit while preserving the full export content', async () => {
  const title = 'A long source title '.repeat(16)
  const remote = convertReadwise(
    [{ id: 'long-reader', title, html_content: '<p>Full Reader body</p>' }],
    [{ user_book_id: 1, title, highlights: [{ text: 'Full highlight' }] }],
  )
  expect(remote.items.map((item) => item.title)).toEqual([title.slice(0, 160), title.slice(0, 160)])
  expect(remote.items.find((item) => item.key === 'reader:long-reader')?.text).toBe(
    'Full Reader body',
  )
  const content = `---\nreader_id: long-export\ntitle: ${title}\n---\nFull export body`
  const directory = await scanExportDirectory(
    {
      files: [{ path: 'long.md', size: new Blob([content]).size }],
      read: async () => new Blob([content]),
    },
    { signal: new AbortController().signal, progress() {}, async yield() {} },
  )
  expect(directory.items[0]?.title).toBe(title.slice(0, 160))
  expect(directory.items[0]?.text).toBe(content)
  expect(directory.complete).toBe(true)
})
