const tags = new Set([
  'P',
  'BR',
  'PRE',
  'CODE',
  'STRONG',
  'EM',
  'B',
  'I',
  'U',
  'S',
  'UL',
  'OL',
  'LI',
  'BLOCKQUOTE',
  'TABLE',
  'THEAD',
  'TBODY',
  'TR',
  'TH',
  'TD',
  'SUP',
  'SUB',
  'SPAN',
  'DIV',
  'H1',
  'H2',
  'H3',
  'H4',
  'HR',
])
const imageHosts = new Set([
  'assets.leetcode.com',
  'assets.leetcode.cn',
  'pic.leetcode.cn',
  'static.leetcode.cn',
])
/** Rebuild allowed elements; no event handlers, inline styles, embedded documents, or scripts. */
export function statementHtml(html: string): string {
  const source = document.createElement('template')
  source.innerHTML = html
  const output = document.createElement('div')
  function copy(node: Node, parent: HTMLElement) {
    if (node.nodeType === Node.TEXT_NODE) {
      parent.append(document.createTextNode(node.textContent ?? ''))
      return
    }
    if (
      !(node instanceof Element) ||
      ['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'SVG', 'MATH', 'TEMPLATE'].includes(node.tagName)
    )
      return
    if (node.tagName === 'IMG') {
      try {
        const src = new URL(node.getAttribute('src') ?? '')
        if (
          src.protocol !== 'https:' ||
          !imageHosts.has(src.hostname) ||
          src.username ||
          src.password ||
          src.port
        )
          return
        const image = document.createElement('img')
        image.src = src.href
        image.alt = node.getAttribute('alt') ?? ''
        image.loading = 'lazy'
        image.referrerPolicy = 'no-referrer'
        parent.append(image)
      } catch {
        /* Invalid image URLs are omitted. */
      }
      return
    }
    const target = tags.has(node.tagName)
      ? document.createElement(node.tagName.toLowerCase())
      : parent
    if (target !== parent) parent.append(target)
    for (const child of node.childNodes) copy(child, target)
  }
  for (const node of source.content.childNodes) copy(node, output)
  return output.innerHTML
}
