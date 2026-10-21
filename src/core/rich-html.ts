import purify from 'isomorphic-dompurify'
import { generate, parse, walk, type CssNode, type List } from 'css-tree'

let sequence = 0
let activeScope = ''
const resourceFunctions = new Set([
  'url',
  'src',
  'image',
  'image-set',
  '-webkit-image-set',
  'cross-fade',
  '-webkit-cross-fade',
  'paint',
  'element',
  '-moz-element',
  'expression',
  'attr',
])

function safeValue(node: CssNode) {
  let safe = true
  walk(node, (part) => {
    if (
      part.type === 'Url' ||
      part.type === 'Raw' ||
      (part.type === 'Function' && resourceFunctions.has(part.name.toLowerCase()))
    )
      safe = false
  })
  return safe
}
function declarations(children: List<CssNode>) {
  const result: string[] = []
  children.forEach((node) => {
    if (
      node.type !== 'Declaration' ||
      !/^(?:--[a-z0-9_-]+|[a-z-]+)$/i.test(node.property) ||
      ['behavior', '-moz-binding', '-webkit-user-modify'].includes(node.property.toLowerCase()) ||
      !safeValue(node.value)
    )
      return
    result.push(generate(node))
  })
  return result.join(';')
}
export function inlineStyle(style: string) {
  // Escape sequences can disguise resource-bearing CSS identifiers. Literal
  // Unicode remains available for text; resource loads never belong in styles.
  if (style.includes('\\')) return ''
  try {
    const tree = parse(style, { context: 'declarationList', parseCustomProperty: true })
    return tree.type === 'DeclarationList' ? declarations(tree.children) : ''
  } catch {
    return ''
  }
}
function stylesheet(css: string, scope: string): string {
  if (css.includes('\\')) return ''
  try {
    const root = parse(css, { parseCustomProperty: true })
    const rules = (nodes: List<CssNode>): string => {
      const result: string[] = []
      nodes.forEach((node) => {
        if (node.type === 'Rule' && node.prelude.type === 'SelectorList') {
          const selectors = node.prelude.children
            .toArray()
            .map((selector) => `[data-repeaty-content="${scope}"] ${generate(selector)}`)
          const body = declarations(node.block.children)
          if (body) result.push(selectors.join(',') + '{' + body + '}')
        } else if (
          node.type === 'Atrule' &&
          node.block &&
          ['media', 'supports', 'container'].includes(node.name.toLowerCase()) &&
          (!node.prelude || safeValue(node.prelude))
        ) {
          const body = rules(node.block.children)
          if (body)
            result.push(
              '@' +
                node.name +
                ' ' +
                (node.prelude ? generate(node.prelude) : '') +
                '{' +
                body +
                '}',
            )
        }
      })
      return result.join('')
    }
    // A style element is a raw-text HTML context, including after serialization.
    return root.type === 'StyleSheet' ? rules(root.children).replaceAll('<', '\\3c ') : ''
  } catch {
    return ''
  }
}

purify.addHook('uponSanitizeElement', (node, data) => {
  if (data.tagName === 'style') node.textContent = stylesheet(node.textContent ?? '', activeScope)
})
purify.addHook('uponSanitizeAttribute', (node, data) => {
  const name = data.attrName.toLowerCase()
  if (name === 'style') {
    data.attrValue = inlineStyle(data.attrValue)
    data.keepAttr = Boolean(data.attrValue)
  }
  if (name === 'src')
    data.keepAttr =
      node.nodeName.toLowerCase() === 'img' &&
      /^data:image\/(?:png|jpeg|gif|webp|avif);base64,[a-z0-9+/=\s]+$/i.test(data.attrValue)
  if (name === 'href')
    data.keepAttr =
      node.nodeName.toLowerCase() === 'a' && /^(?:https?:\/\/|mailto:)/i.test(data.attrValue)
  if (name === 'xlink:href') data.keepAttr = false
})
purify.addHook('afterSanitizeAttributes', (node) => {
  if (node.nodeName.toLowerCase() === 'a') {
    node.setAttribute('target', '_blank')
    node.setAttribute('rel', 'noopener noreferrer')
  }
})

export function contentScope() {
  return 'content-' + ++sequence
}
export function cleanHtml(html: string, scope: string) {
  activeScope = scope
  try {
    return purify.sanitize(html, {
      ADD_TAGS: ['style'],
      FORCE_BODY: true,
      ALLOW_DATA_ATTR: false,
      FORBID_TAGS: [
        'iframe',
        'object',
        'embed',
        'link',
        'meta',
        'base',
        'form',
        'input',
        'button',
        'textarea',
        'select',
        'option',
        'template',
        'audio',
        'video',
        'source',
        'foreignobject',
        'animate',
        'set',
        'image',
        'use',
      ],
      FORBID_ATTR: [
        'id',
        'name',
        'srcset',
        'poster',
        'background',
        'autofocus',
        'contenteditable',
        'tabindex',
        'is',
        'slot',
      ],
    })
  } finally {
    activeScope = ''
  }
}
export function wrapHtml(html: string, scope: string) {
  return `<div class="rich-content" data-repeaty-content="${scope}">${html}</div>`
}
