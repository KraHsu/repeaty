import { describe, expect, it } from 'vitest'
import { renderMarkdown, renderReadingMarkdown } from './content'
import { insertCloze } from './authoring'
import { cardViews, clozes } from './model'
import { fixture } from './test-fixtures'

describe('Markdown and math rendering', () => {
  it('renders structured Markdown and inline/block math, keeping code literal', () => {
    const html = renderMarkdown(
      '**Bold**\n\n- one\n- two\n\n$x^2$\n\n$$\n\\frac{1}{2}\n$$\n\n`$no math$`',
    )
    expect(html).toContain('<strong>Bold</strong>')
    expect(html).toContain('<ul>')
    expect(html).toContain('class="katex"')
    expect(html).toContain('class="katex-display"')
    expect(html).toContain('<code>$no math$</code>')
    expect(renderMarkdown('\\$5 and $10')).not.toContain('class="katex"')
    expect(renderMarkdown('$$x^2$$')).toContain('katex-display')
  })
  it('keeps HTML presentation but removes active content, unsafe links and remote resources', () => {
    const html = renderMarkdown(
      '<img src=x onerror=alert(1)>\n\n[x](javascript:alert%281%29) ![pic](https://example.com/a.png)\n\n$\\href{javascript:alert(1)}{click}$ $\\includegraphics{https://example.com/a.png}$',
    )
    expect(html).not.toMatch(/<script|onerror|href="javascript:|src="https?:|src="x"/i)
    expect(html).toContain('请使用附件')
    expect(renderMarkdown('[link](https://example.com)')).toContain('rel="noopener noreferrer"')
  })
  it('renders parenthesis and bracket math without touching code, escaped markers or unclosed expressions', () => {
    for (const source of ['\\(x^2\\)', '$x^2$'])
      expect(renderMarkdown('Before ' + source + ' after')).toContain('class="katex"')
    for (const source of ['\\[x^2\\]', '\\[\n\\frac{1}{2}\n\\]', '$$x^2$$'])
      expect(renderMarkdown(source)).toContain('class="katex-display"')
    expect(renderMarkdown('`\\(x\\)`')).not.toContain('class="katex"')
    expect(renderMarkdown('```tex\n\\[x\\]\n```')).not.toContain('class="katex-display"')
    expect(renderMarkdown('\\\\(x\\\\)')).not.toContain('class="katex"')
    expect(renderMarkdown('\\[unclosed')).not.toContain('class="katex"')
    const source = 'First\n\n\\[\nx^2\n\\]\n\nLast'
    expect(renderReadingMarkdown(source)).toContain(
      `data-reading-offset="${source.indexOf('Last')}"`,
    )
  })
  it('preserves inline styles and scopes stylesheets while blocking CSS resource loads and global selectors', () => {
    const html = renderMarkdown(
      '<style>.note, .topbar { color: red; background: url(https://example.invalid/x) } @import "https://example.invalid/s.css";</style>\n\n<div class="note" style="display: grid; gap: 12px; color: #123; background: linear-gradient(red, blue)">Styled <strong>HTML</strong></div>',
    )
    expect(html).toContain('display:grid')
    expect(html).toContain('gap:12px')
    expect(html).toContain('linear-gradient(red,blue)')
    expect(html).toMatch(/\[data-repeaty-content="content-\d+"\] \.topbar/)
    expect(html).not.toContain('url(')
    expect(html).not.toContain('@import')
    const unsafe = renderMarkdown(
      '<div id="app" name="location" data-reading-offset="100" style="background:image-set(\"https://example.invalid/x\" 1x)" onclick="alert(1)"><iframe srcdoc="bad"></iframe><script>alert(1)</script>Safe</div>',
    )
    expect(unsafe).not.toMatch(
      /id="app"|name=|data-reading-offset|onclick|<iframe|<script|image-set/,
    )
    expect(unsafe).toContain('Safe')
    expect(
      renderMarkdown('<div style="background:u\\72l(https://example.invalid/x)">Safe</div>'),
    ).not.toContain('style=')
  })
  it('recovers from invalid math without crashing', () => {
    expect(renderMarkdown('$\\frac{$')).toContain('katex-error')
    expect(renderMarkdown('$$\nnot closed')).toContain('not closed')
  })
  it('renders Chinese punctuation at a closing strong marker without changing literal code or source offsets', () => {
    const source = '**中文：**中文中文\n\nSecond paragraph'
    expect(renderMarkdown(source)).toContain('<strong>中文：</strong> 中文中文')
    expect(renderMarkdown('**Note:**中文')).toContain('<strong>Note:</strong> 中文')
    expect(renderMarkdown('**中文：** 中文')).not.toContain('</strong>  ')
    expect(renderMarkdown('`**中文：**中文`')).toContain('<code>**中文：**中文</code>')
    expect(renderMarkdown('\\*\\*中文：\\*\\*中文')).not.toContain('<strong>')
    expect(renderMarkdown('```text\n**中文：**中文\n```')).not.toContain('<strong>')
    expect(renderMarkdown('[**中文：**中文](https://example.com/a**b)')).toContain(
      'href="https://example.com/a**b"',
    )
    expect(renderReadingMarkdown(source)).toContain(
      `data-reading-offset="${source.indexOf('Second')}"`,
    )
    expect(renderReadingMarkdown(source)).toContain('<strong>中文：</strong> 中文中文')
  })
  it('highlights explicit fence languages and aliases, safely falling back for unknown or oversized code', () => {
    expect(renderMarkdown('```python\ndef answer():\n    return 42\n```')).toContain('hljs-keyword')
    expect(renderMarkdown('```js\nconst answer = "<script>";\n```')).toContain('hljs-keyword')
    expect(renderMarkdown('```rust\nfn main() {}\n```')).toContain('hljs-keyword')
    const unknown = renderMarkdown('```unknown\n<script>alert(1)</script>\n```')
    expect(unknown).toContain('&lt;script&gt;')
    expect(unknown).not.toContain('<script>')
    expect(unknown).not.toContain('hljs-')
    expect(renderMarkdown('```\nconst plain = 1;\n```')).not.toContain('hljs-')
    expect(renderMarkdown('```python\n' + 'return 1\n'.repeat(15_000) + '```')).not.toContain(
      'hljs-keyword',
    )
  })
})
describe('cloze authoring', () => {
  it('extracts only the current deletion answers, separately from optional extra information', () => {
    const views = cardViews(
      fixture({
        type: 'cloze',
        front: '{{c1::Paris::city}} and {{c1::Lyon}} are in {{c2::France}}.',
        back: '',
      }),
    )
    expect(views[0]!.cloze).toEqual({
      answers: ['Paris', 'Lyon'],
      context: 'Paris and Lyon are in France.',
      extra: '',
    })
    expect(views[1]!.cloze?.answers).toEqual(['France'])
    expect(views[0]!.front).toBe('[city] and […] are in France.')
  })
  it('preserves legacy trailing backslashes and literal replacement metacharacters', () => {
    expect(clozes('{{c1::C:\\}}')[0]!.answer).toBe('C:\\')
    const [view] = cardViews(fixture({ type: 'cloze', front: '{{c1::$&::$`}}' }))
    expect(view!.front).toBe('[$`]')
    expect(view!.back).toContain('$&')
    expect(view!.back).not.toContain('{{c1::')
  })
  it('inserts selected text with next unused number and preserves surrounding content', () => {
    const text = '{{c1::Paris}} and Tokyo'
    const result = insertCloze(text, text.indexOf('Tokyo'), text.length)
    expect(result.text).toBe('{{c1::Paris}} and {{c2::Tokyo}}')
    expect(result.cursor).toBe(result.text.length)
    expect(() => insertCloze(text, 0, 0)).toThrow('选中')
    expect(() => insertCloze(text, 6, 11)).toThrow('嵌套')
    expect(() => insertCloze(text, 0, 13)).toThrow('嵌套')
  })
  it('allows balanced LaTeX braces in cloze answers without leaking the answer', () => {
    const source = 'Value: {{c1::$\\sqrt{\\frac{1}{2}}$::formula}} and {{c2::two}}'
    expect(clozes(source)).toHaveLength(2)
    const [first] = cardViews(fixture({ type: 'cloze', format: 'markdown', front: source }))
    expect(first!.front).toBe('Value: [formula] and two')
    expect(first!.back).toContain('$\\sqrt{\\frac{1}{2}}$')
    expect(renderMarkdown(first!.back)).toContain('katex')
    expect(() => clozes('{{c1::outer {{c2::inner}}}}')).toThrow('嵌套')
  })
})
