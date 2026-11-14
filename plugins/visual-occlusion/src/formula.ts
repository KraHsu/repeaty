import katex from 'katex'
export const RENDERER = 'katex@0.19.0'
export interface Formula {
  start: number
  end: number
  latex: string
}

/** Offsets address the complete original Markdown span, including delimiters. */
export function formulas(text: string): Formula[] {
  const result: Formula[] = []
  let index = 0
  while (index < text.length && result.length < 200) {
    const start = index
    if (text[index] === '`' || (text[index] === '~' && (index === 0 || text[index - 1] === '\n'))) {
      const char = text[index]!,
        run = text.slice(index).match(new RegExp(`^${char}+`))![0]
      const end = text.indexOf(run, index + run.length)
      index = end < 0 ? text.length : end + run.length
      continue
    }
    const open = text.startsWith('$$', index)
      ? '$$'
      : text.startsWith('\\[', index)
        ? '\\['
        : text.startsWith('\\(', index)
          ? '\\('
          : text[index] === '$'
            ? '$'
            : undefined
    if (!open) {
      index += text[index] === '\\' ? 2 : 1
      continue
    }
    const close = open === '\\[' ? '\\]' : open === '\\(' ? '\\)' : open
    let end = index + open.length
    if (open === '$' && /\s/.test(text[end] ?? '')) {
      index++
      continue
    }
    for (; end < text.length; end++) {
      if (text.startsWith(close, end) && (open !== '$' || !/\s/.test(text[end - 1] ?? ''))) break
      if (text[end] === '\\') end++
      if (open === '$' && text[end] === '\n') break
    }
    if (!text.startsWith(close, end)) {
      index += open.length
      continue
    }
    const latex = text.slice(index + open.length, end).trim()
    index = end + close.length
    if (latex && latex.length <= 8_000) result.push({ start, end: index, latex })
  }
  return result
}
export function renderFormula(latex: string) {
  if (!latex.trim() || latex.length > 8_000) throw new Error('公式不能为空，且最多 8000 个字符。')
  return katex.renderToString(latex, {
    throwOnError: true,
    trust: false,
    strict: 'error',
    output: 'html',
    displayMode: true,
    maxExpand: 1000,
    maxSize: 20,
  })
}
/** Only walks the plugin's own rendered KaTeX tree; never the host's DOM. */
export function formulaLeaves(root: HTMLElement): { nodes: HTMLElement[]; tokens: string[] } {
  const walker = root.ownerDocument.createTreeWalker(root, 4)
  const texts: Text[] = []
  while (walker.nextNode())
    if (walker.currentNode.textContent?.trim()) texts.push(walker.currentNode as Text)
  if (texts.length > 4096) throw new Error('公式包含过多可选元素。')
  const nodes = texts.map((text, index) => {
    const node = root.ownerDocument.createElement('span')
    node.dataset.formulaLeaf = String(index)
    text.replaceWith(node)
    node.append(text)
    return node
  })
  return { nodes, tokens: nodes.map((node) => node.textContent ?? '') }
}
export function leavesInRange(nodes: HTMLElement[], range: Range): number[] {
  return nodes.flatMap((node, index) => (range.intersectsNode(node) ? [index] : []))
}
export function sameTokens(expected: readonly string[], actual: readonly string[]) {
  return expected.length === actual.length && expected.every((token, i) => token === actual[i])
}
