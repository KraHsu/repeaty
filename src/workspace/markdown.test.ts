import { describe, expect, it } from 'vitest'
import {
  createWorkspaceMarkdown,
  readWorkspaceBytes,
  readWorkspaceMarkdown,
  rewriteWorkspaceContent,
  workspaceBytes,
  MAX_FRONTMATTER_BYTES,
  type JsonObject,
  type WorkspaceDocument,
} from './markdown'

export function properties(overrides: JsonObject = {}): JsonObject {
  return {
    repeaty: {
      version: 1,
      kind: 'note',
      id: 'note-旧-id',
      type: 'basic',
      format: 'markdown',
      deckId: 'deck-old',
      ...overrides,
    },
    tags: ['中文'],
  }
}
export function document(raw: string): WorkspaceDocument {
  const result = readWorkspaceMarkdown(raw)
  expect(result.status).toBe('managed')
  if (result.status !== 'managed') throw new Error(JSON.stringify(result))
  return result.document
}

describe('workspace Markdown framing', () => {
  it.each([
    ['中文🙂 **中文：**后文', '答案 🧠'],
    ['\n\n问题\n\n', '\n\n答案\n\n'],
    ['\r\n\r\n问题\r\n', '\r\n答案\r\n\r\n'],
    ['末尾单独 CR\r', '\r开头的 CR\r'],
    ['<div style="color: red">题目</div>', '<table><tr><td>答案</td></tr></table>'],
    ['$$a^2$$\n\\(b\\)', '\\[c\\]\n---\n## 正文标题'],
    ['```typescript\nconst unfinished = true', '```\n---\n答案'],
    ['---\nrepeaty: 不属于元数据\n---', '    缩进和\t制表符  '],
    ['<!-- repeaty:answer -->', '<!-- repeaty:answer -->\n'],
    ['```html\n<!-- repeaty:answer -->\n```', 'literal'],
    ['\n<!-- repeaty-answer-1 -->\n<!-- repeaty:answer -->\n', '<!-- repeaty-answer-2 -->'],
  ])('preserves both exact faces through UTF-8 files: %j', (front, back) => {
    const raw = createWorkspaceMarkdown(properties(), { kind: 'note', front, back })
    const parsed = readWorkspaceBytes(workspaceBytes(raw))
    expect(parsed.status).toBe('managed')
    const note = document(raw)
    expect(note.content).toEqual({ kind: 'note', front, back })
    expect(rewriteWorkspaceContent(note, note.content)).toBe(raw)
    expect(note.identity.id).toBe('note-旧-id')
    expect(note.variants).toEqual(['forward'])
  })

  it('preserves CRLF, BOM, comments, flow properties and exact header on a body edit', () => {
    const raw =
      '\uFEFF---\r\n# 外部编辑器注释\r\nrepeaty: {version: 1, kind: note, id: old, type: reversed, format: plain, deckId: deck}\r\ncustom: {owner: "Ada", count: 3, when: 2026-10-25}\r\ntags: [中文, test]\r\n---\r\n\r\n问题\r\n\r\n<!-- repeaty:answer -->\r\n答案\r\n'
    const note = document(raw)
    expect(note.content).toEqual({ kind: 'note', front: '\r\n问题\r\n', back: '答案\r\n' })
    expect(note.variants).toEqual(['forward', 'reverse'])
    expect(rewriteWorkspaceContent(note, note.content)).toBe(raw)
    const changed = document(
      rewriteWorkspaceContent(note, { kind: 'note', front: '新问题\r', back: '\n新答案\n' }),
    )
    expect(changed.headerRaw).toBe(note.headerRaw)
    expect(changed.properties.custom).toEqual({ owner: 'Ada', count: 3, when: '2026-10-25' })
    expect(changed.content).toEqual({ kind: 'note', front: '新问题\r', back: '\n新答案\n' })
    expect(changed.identity).toEqual(note.identity)
  })

  it.each(['', '\n', '\r\n', '\r', '  \t'])(
    'allows incomplete draft faces without creating cards (%j)',
    (text) => {
      const draft = document(
        createWorkspaceMarkdown(properties({ kind: 'draft' }), {
          kind: 'draft',
          front: text,
          back: '',
        }),
      )
      expect(draft.content).toEqual({ kind: 'draft', front: text, back: '' })
      expect(draft.variants).toEqual([])
    },
  )

  it('keeps cloze numbering, empty back, and literal whitespace', () => {
    const content = {
      kind: 'note',
      front: '\n{{c8::中文🙂}} + {{c1::a::hint}} + {{c8::b}}\n',
      back: '',
    } as const
    const note = document(createWorkspaceMarkdown(properties({ type: 'cloze' }), content))
    expect(note.content).toEqual(content)
    expect(note.variants).toEqual(['cloze:1', 'cloze:8'])
  })

  it('retains unknown plugin JSON and original explicit media IDs/paths', () => {
    const props = properties({
      type: 'plugin',
      plugin: {
        id: 'unknown-local-plugin',
        version: 2,
        data: { difficulty: 2, opaque: [null, true, 'x'] },
      },
      frontMedia: [{ id: 'original-media', path: 'assets/图片.png' }],
    })
    const note = document(createWorkspaceMarkdown(props, { kind: 'note', front: '题目', back: '' }))
    expect(note.properties).toEqual(props)
    expect(note.content).toEqual({ kind: 'note', front: '题目', back: '' })
  })

  it('source body has no answer syntax and uses body-relative UTF-16 offsets', () => {
    const body = '\n原文🙂\r\n<!-- repeaty:answer -->\n'
    const source = document(
      createWorkspaceMarkdown(
        { repeaty: { version: 1, kind: 'source', id: 'source', format: 'markdown' } },
        { kind: 'source', body },
      ),
    )
    expect(source.content).toEqual({ kind: 'source', body })
    expect(source.variants).toEqual([])
    expect(body.slice(body.indexOf('🙂'), body.indexOf('🙂') + 2)).toBe('🙂')
  })

  it('does not truncate large plugin data supported by the old library', () => {
    const data = { description: '中文🙂'.repeat(40_000) }
    const note = document(
      createWorkspaceMarkdown(
        properties({
          type: 'plugin',
          plugin: { id: 'large-plugin', version: 1, data },
        }),
        { kind: 'note', front: 'Q', back: '' },
      ),
    )
    expect(note.header.plugin?.data).toEqual(data)
  })

  it('handles a boundary at EOF, and unchanged input remains byte-for-byte identical', () => {
    const raw = createWorkspaceMarkdown(properties({ type: 'cloze' }), {
      kind: 'note',
      front: '{{c1::x}}',
      back: '',
    }).slice(0, -1)
    const note = document(raw)
    expect(note.content).toEqual({ kind: 'note', front: '{{c1::x}}', back: '' })
    expect(rewriteWorkspaceContent(note, note.content)).toBe(raw)
  })

  it('refuses a newly introduced marker collision without rewriting header metadata', () => {
    const note = document(
      createWorkspaceMarkdown(properties(), { kind: 'note', front: 'Q', back: 'A' }),
    )
    expect(() =>
      rewriteWorkspaceContent(note, { kind: 'note', front: '<!-- repeaty:answer -->', back: 'A' }),
    ).toThrow('answer-marker-collision')
  })
})

describe('untrusted and incomplete workspace documents', () => {
  const header =
    '---\nrepeaty: { version: 1, kind: note, id: old, type: basic, format: markdown, deckId: deck }\n'
  const faces = '---\nQ\n<!-- repeaty:answer -->\nA'
  it.each([
    ['a: &anchor {x: 1}\nb: *anchor\n', 'yaml-tag-or-anchor-not-allowed'],
    ['a: *absent\n', 'yaml-alias-not-allowed'],
    ['a: !!str text\n', 'yaml-tag-or-anchor-not-allowed'],
    ['a: !include /etc/passwd\n', 'invalid-yaml'],
    ['a: 1\na: 2\n', 'invalid-yaml'],
    ['a: .inf\n', 'metadata-value-must-be-json'],
    ['? [complex, key]\n: value\n', 'invalid-yaml'],
    [`a: ${'['.repeat(40)}0${']'.repeat(40)}\n`, 'metadata-complexity'],
    [`a: "${'x'.repeat(MAX_FRONTMATTER_BYTES)}"\n`, 'frontmatter-too-large'],
  ])('rejects unsafe YAML (%j)', (extra, reason) => {
    expect(readWorkspaceMarkdown(header + extra + faces)).toMatchObject({
      status: 'pending',
      reason,
    })
  })
  it('treats prototype-shaped unknown properties as data', () => {
    const note = document(header + '__proto__: { polluted: true }\nconstructor: ordinary\n' + faces)
    expect(note.properties.__proto__).toEqual({ polluted: true })
    expect({}).not.toHaveProperty('polluted')
  })
  it.each([
    ['---\nQ', 'unclosed-frontmatter'],
    [header + '---\nQ\nA', 'missing-answer-boundary'],
    [header + faces + '\n<!-- repeaty:answer -->\nX', 'ambiguous-answer-boundary'],
    [header + '---\nQ\n<!-- repeaty:answer -->\r\nA', 'mixed-boundary-line-endings'],
    [header + '---\nQ\n<!-- repeaty:answer -->\n', 'empty-answer'],
    [header.replace('version: 1', 'version: 9') + faces, 'invalid-repeaty-metadata'],
  ])('keeps invalid input pending (%j)', (raw, reason) => {
    expect(readWorkspaceMarkdown(raw)).toMatchObject({ status: 'pending', reason })
  })
  it('retains identity on invalid body but does not invent identity for missing IDs', () => {
    expect(readWorkspaceMarkdown(header + '---\nunfinished')).toMatchObject({
      status: 'pending',
      identity: { kind: 'note', id: 'old' },
    })
    expect(readWorkspaceMarkdown(header.replace('id: old, ', '') + faces)).toEqual({
      status: 'unregistered',
      kind: 'note',
    })
    expect(readWorkspaceMarkdown('Ordinary Markdown')).toEqual({ status: 'unmanaged' })
    expect(readWorkspaceMarkdown('---\neditor: ordinary\n---\ntext')).toEqual({
      status: 'unmanaged',
    })
  })
  it('does not accept malformed UTF-8 or silently replace unpaired surrogates', () => {
    expect(readWorkspaceBytes(new Uint8Array([0xff, 0xfe]))).toEqual({
      status: 'pending',
      reason: 'invalid-utf8',
    })
    expect(() => workspaceBytes('unpaired \ud800')).toThrow('invalid-unicode')
  })
})
