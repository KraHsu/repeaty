import { expect, it } from 'vitest'
import type { PublishingSource } from '@repeaty/plugin-api'
import { emptyLedger } from './engine'
import { publicMarkdown, renderMarkdown } from './render'
import type { Ledger } from './types'
const site = 'https://example.com'
function source(body: string): PublishingSource {
  return {
    id: 'selected',
    versionId: 'version',
    title: '公开材料',
    body,
    format: 'markdown',
    createdAt: '',
    updatedAt: '',
    assets: [],
    fields: {},
    links: [
      { reference: '学习', sourceId: 'linked' },
      { reference: 'source:linked', sourceId: 'linked' },
      { reference: 'repeaty-source:note.md#section', sourceId: 'linked', fragment: 'section' },
    ],
  }
}
const ledger: Ledger = {
  version: 1,
  bindings: {
    [`${site}\nlinked`]: {
      sourceId: 'linked',
      site,
      adapter: 'rest',
      marker: '',
      state: 'ready',
      remote: {
        id: '7',
        url: `${site}/public`,
        title: '',
        content: '',
        status: 'publish',
        category: '',
        tags: [],
        revision: '',
      },
    },
  },
}
it('rewrites only Wiki and Markdown destinations, preserving ordinary words and code', () => {
  const body =
    '学习是日常任务。[[学习|去学习]] 和 [[source:linked|已发布文章]]\n\n`学习 [[学习]]`\n\n```ts\nconst 学习 = "[[学习]]"\n```\n\n[文章](repeaty-source:note.md#section)'
  const output = publicMarkdown(source(body), ledger, site)
  expect(output).toContain('学习是日常任务。[去学习](<https://example.com/public>)')
  expect(output).toContain('[已发布文章](<https://example.com/public>)')
  expect(output).toContain('`学习 [[学习]]`')
  expect(output).toContain('const 学习 = "[[学习]]"')
  expect(output).toContain('[文章](<https://example.com/public#section>)')
  expect(output).not.toContain('source:linked')
})
it('does not expose unmapped or unpublished internal identities', () => {
  for (const body of [
    '[[source:secret|未选择]]',
    '[内部](repeaty-source:private.md)',
    '[[学习]]',
    '`[[source:secret|代码]]`',
  ])
    expect(() => publicMarkdown(source(body), emptyLedger(), site)).toThrow('local-links')
})
it('audits disallowed destinations even when the display renderer would turn them into text', () => {
  for (const body of [
    '[文件](file:///C:/private)',
    '![图片](../assets/a.png)',
    '[笔记](notes/private.md)',
    '[脚本](javascript:alert(1))',
    '<img src="file:///C:/private">',
    '[引用][local]\n\n[local]: ../private',
    '[unused]: /private',
    'C:\\Users\\private',
    '\\\\server\\share',
  ])
    expect(() => publicMarkdown(source(body), ledger, site)).toThrow('local-links')
  expect(() =>
    publicMarkdown(
      {
        ...source('正文'),
        assets: [{ id: 'media', reference: 'assets/a.png', size: 1, type: 'image/png' }],
      },
      ledger,
      site,
    ),
  ).toThrow('local-assets')
})
it('preserves public Markdown, tables, language-labelled code and formula text without executing HTML', () => {
  const body =
    '# 标题\n\n**中文加粗**\n\n|A|B|\n|-|-|\n|1|2|\n\n```ts\nconst a = 1\n```\n\n$x^2$\n\n![图](https://example.com/image.png)'
  const html = renderMarkdown(publicMarkdown(source(body), ledger, site))
  expect(html).toContain('<strong>中文加粗</strong>')
  expect(html).toContain('<table>')
  expect(html).toContain('language-ts')
  expect(html).toContain('$x^2$')
  expect(html).not.toContain('<script>')
})
