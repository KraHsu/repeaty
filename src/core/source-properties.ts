import { isAlias, isMap, isScalar, isSeq, parseDocument } from 'yaml'

export const MAX_SOURCE_PROPERTIES = 65_536
const reserved = new Set(['repeaty', 'title', 'url'])
export function parseSourceProperties(
  text: string,
  options: { allowReserved?: boolean } = {},
): Record<string, unknown> {
  if (text.length > MAX_SOURCE_PROPERTIES) throw new Error('材料属性不能超过 65536 个字符。')
  if (!text.trim()) return {}
  const doc = parseDocument(text, { schema: 'core', uniqueKeys: true, stringKeys: true })
  if (doc.errors.length || doc.warnings.length || !isMap(doc.contents))
    throw new Error('材料属性必须是有效的 YAML 对象。')
  let nodes = 0
  function read(node: unknown, depth: number): unknown {
    if (++nodes > 10_000 || depth > 16) throw new Error('材料属性嵌套过深或内容过多。')
    if (node === null) return null
    if (isAlias(node) || (!isMap(node) && !isSeq(node) && !isScalar(node)))
      throw new Error('材料属性不支持 YAML 引用或自定义类型。')
    if (node.tag || ('anchor' in node && node.anchor))
      throw new Error('材料属性不支持 YAML 引用或自定义类型。')
    if (isMap(node)) {
      const result: Record<string, unknown> = Object.create(null)
      for (const pair of node.items) {
        const key = read(pair.key, depth + 1)
        if (typeof key !== 'string' || ['__proto__', 'constructor', 'prototype'].includes(key))
          throw new Error('材料属性名称无效。')
        result[key] = read(pair.value, depth + 1)
      }
      return result
    }
    if (isSeq(node)) return node.items.map((item) => read(item, depth + 1))
    const value = node.value
    if (
      value === null ||
      typeof value === 'string' ||
      typeof value === 'boolean' ||
      (typeof value === 'number' && Number.isFinite(value))
    )
      return value
    throw new Error('材料属性值无效。')
  }
  const result = read(doc.contents, 0) as Record<string, unknown>
  if (!options.allowReserved && Object.keys(result).some((key) => reserved.has(key)))
    throw new Error('repeaty、title 和 url 由材料管理，请在对应字段中修改。')
  return result
}

export const sourcePropertyReserved = (key: string) => reserved.has(key)
