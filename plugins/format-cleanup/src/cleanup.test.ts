import { expect, it } from 'vitest'
import { cleanupText, type CleanupOptions } from './cleanup'
const options: CleanupOptions = {
  trimTrailing: true,
  collapseBlankLines: true,
  normalizeIndent: true,
  rules: [],
}
it('cleans whitespace while preserving Markdown hard breaks and code bytes', () => {
  const text = '标题 \n\n\n\n正文    \n\n```js\n代码  \n\t  内容\n```\n\n    indented  \n'
  expect(cleanupText(text, options)).toBe(
    '标题\n\n正文  \n\n```js\n代码  \n\t  内容\n```\n\n    indented  \n',
  )
})
it('replaces literal text and regex groups in order without modifying code, URL destinations, reference definitions or YAML', () => {
  const text =
    '---\nname: foo\n---\nfoo 12 foo\n`foo` and ``foo ` bar``\n[foo](relative/foo(a)) https://foo.example/foo\n[id]: relative/foo\n<mark data-name="foo">foo</mark>\n'
  expect(
    cleanupText(text, {
      ...options,
      rules: [
        { kind: 'literal', find: 'foo', replace: 'bar' },
        { kind: 'regex', find: '(bar) (\\d+)', replace: '$2:$1' },
      ],
    }),
  ).toBe(
    '---\nname: foo\n---\n12:bar bar\n`foo` and ``foo ` bar``\n[bar](relative/foo(a)) https://foo.example/foo\n[id]: relative/foo\n<mark data-name="foo">bar</mark>\n',
  )
})
it('protects fenced blocks inside list/quote containers and unclosed fences', () => {
  const text = '> - ~~~txt\n> foo\n> ~~~\nfoo\n```\nfoo'
  expect(
    cleanupText(text, { ...options, rules: [{ kind: 'literal', find: 'foo', replace: 'bar' }] }),
  ).toBe('> - ~~~txt\n> foo\n> ~~~\nbar\n```\nfoo')
})
it('keeps literal dollar replacement and Unicode intact, and protects newly created code', () => {
  expect(
    cleanupText('中文🙂 foo foo', {
      ...options,
      rules: [
        { kind: 'literal', find: 'foo', replace: '`$1🙂`' },
        { kind: 'literal', find: '🙂', replace: '🧩' },
      ],
    }),
  ).toBe('中文🧩 `$1🙂` `$1🙂`')
})
it('rejects invalid patterns, blank patterns, giant output and blank documents', () => {
  expect(() =>
    cleanupText('a', { ...options, rules: [{ kind: 'regex', find: '(', replace: '' }] }),
  ).toThrow()
  expect(() =>
    cleanupText('a', { ...options, rules: [{ kind: 'literal', find: '', replace: '' }] }),
  ).toThrow('规则无效')
  expect(() =>
    cleanupText('a', {
      ...options,
      rules: [{ kind: 'regex', find: 'a', replace: '', flags: 's' }],
    }),
  ).toThrow('正则标志')
  expect(() =>
    cleanupText('a'.repeat(1000), {
      ...options,
      rules: [{ kind: 'literal', find: 'a', replace: 'b'.repeat(1000) }],
    }),
  ).toThrow('超过')
  expect(() =>
    cleanupText('a', { ...options, rules: [{ kind: 'literal', find: 'a', replace: '' }] }),
  ).toThrow('为空')
})
it('is self-contained when serialized for a worker, with no imported runtime dependencies', () => {
  const execute = new Function(`return (${cleanupText.toString()})`)() as typeof cleanupText
  expect(execute('foo ', options)).toBe('foo')
})
it('preserves indentation after collapsed blank lines and addresses in references, Wiki and HTML', () => {
  const text =
    'foo\n\n\n  foo\n[foo][id-foo] [id-foo][] [id-foo]\n[id-foo]:\n relative/foo\n[[foo|foo]] [[foo]] HTTPS://EXAMPLE.test/foo\n<code>foo</code> <a title="foo>foo">foo</a>\n\\\\`foo`'
  expect(
    cleanupText(text, { ...options, rules: [{ kind: 'literal', find: 'foo', replace: 'bar' }] }),
  ).toBe(
    'bar\n\n  bar\n[bar][id-foo] [id-foo][] [id-foo]\n[id-foo]:\n relative/foo\n[[foo|bar]] [[foo]] HTTPS://EXAMPLE.test/foo\n<code>foo</code> <a title="foo>foo">bar</a>\n\\\\`foo`',
  )
})
it('implements JavaScript substitution semantics with bounded intermediate allocations', () => {
  for (const replace of ['$1:$2:$12:$99:$$:$&:$01:$00:$09', "$`-$'", '$<first>:$<missing>']) {
    const find = '(?<first>a)(b)?',
      sample = 'ab ax'
    expect(
      cleanupText(sample, {
        trimTrailing: false,
        collapseBlankLines: false,
        normalizeIndent: false,
        rules: [{ kind: 'regex', find, replace }],
      }),
    ).toBe(sample.replace(new RegExp(find, 'gu'), replace))
  }
  expect(() =>
    cleanupText('a'.repeat(250_000), {
      ...options,
      rules: [{ kind: 'literal', find: 'a', replace: 'b'.repeat(1000) }],
    }),
  ).toThrow('超过')
  expect(() =>
    cleanupText('a'.repeat(250_000), {
      ...options,
      rules: [{ kind: 'regex', find: 'a', replace: "$'".repeat(500) }],
    }),
  ).toThrow('超过')
})
it('matches regexes against full document context and skips protected intersections', () => {
  const run = (find: string, replace = 'changed') =>
    cleanupText('before `code`after', { ...options, rules: [{ kind: 'regex', find, replace }] })
  expect(run('^after')).toBe('before `code`after')
  expect(run('before $')).toBe('before `code`after')
  expect(run('(?<=`code`)after')).toBe('before `code`changed')
  expect(run('before.*after')).toBe('before `code`after')
  expect(run('after', '$`$&')).toBe('before `code`before `code`after')
})
it('does not mistake literal list markers or quoted fences inside code for closing delimiters', () => {
  const sample = '```md\n- ```\nfoo\n> ```\nfoo\n```\nfoo'
  expect(
    cleanupText(sample, { ...options, rules: [{ kind: 'literal', find: 'foo', replace: 'bar' }] }),
  ).toBe('```md\n- ```\nfoo\n> ```\nfoo\n```\nbar')
})
