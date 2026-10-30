// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { formulaLeaves, formulas, leavesInRange, renderFormula, sameTokens } from './formula'
describe('source formula spans', () => {
  it('preserves exact offsets across all delimiters and skips escaped dollars and code', () => {
    const text =
      '中文 $a+b$ and \\(c^2\\)\n$$\\frac{x}{y}$$ \\[z\\]\n`$ignore$`\n```tex\n$$skip$$\n```\n\\$price'
    const found = formulas(text)
    expect(found.map((item) => item.latex)).toEqual(['a+b', 'c^2', '\\frac{x}{y}', 'z'])
    expect(found.map((item) => text.slice(item.start, item.end))).toEqual([
      '$a+b$',
      '\\(c^2\\)',
      '$$\\frac{x}{y}$$',
      '\\[z\\]',
    ])
  })
  it('bounds expansion and rejects untrusted HTML commands', () => {
    expect(() => renderFormula('\\def\\foo{\\foo}\\foo')).toThrow()
    expect(() => renderFormula('x'.repeat(8001))).toThrow('8000')
    expect(renderFormula('\\href{javascript:alert(1)}{x}')).not.toContain('href=')
  })
})
describe('rendered DOM leaf selection', () => {
  it('selects the rendered denominator rather than LaTeX text offsets', () => {
    const host = document.createElement('div')
    host.innerHTML = '<span>Host content</span>'
    const own = document.createElement('div')
    host.append(own)
    own.innerHTML = renderFormula('\\frac{a+b}{c^2}')
    const { nodes, tokens } = formulaLeaves(own)
    expect(tokens).toEqual(expect.arrayContaining(['a', 'b', 'c', '2']))
    expect(host.firstElementChild?.querySelector('[data-formula-leaf]')).toBeNull()
    const index = tokens.indexOf('c'),
      range = document.createRange()
    range.selectNodeContents(nodes[index]!)
    expect(leavesInRange(nodes, range)).toEqual([index])
    expect(
      sameTokens(
        tokens,
        formulaLeaves(
          Object.assign(document.createElement('div'), {
            innerHTML: renderFormula('\\frac{a+b}{c^2}'),
          }),
        ).tokens,
      ),
    ).toBe(true)
  })
})
