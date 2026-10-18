import { describe, expect, it } from 'vitest'
import { renderMarkdown } from './content'
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
  it('disables HTML, unsafe links, remote images and trusted TeX commands', () => {
    const html = renderMarkdown(
      '<img src=x onerror=alert(1)>\n\n[x](javascript:alert%281%29) ![pic](https://example.com/a.png)\n\n$\\href{javascript:alert(1)}{click}$ $\\includegraphics{https://example.com/a.png}$',
    )
    expect(html).not.toMatch(/<img|<script|href="javascript:|src="https:/i)
    expect(html).toContain('&lt;img')
    expect(html).toContain('请使用附件')
    expect(renderMarkdown('[link](https://example.com)')).toContain('rel="noopener noreferrer"')
  })
  it('recovers from invalid math without crashing', () => {
    expect(renderMarkdown('$\\frac{$')).toContain('katex-error')
    expect(renderMarkdown('$$\nnot closed')).toContain('not closed')
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
