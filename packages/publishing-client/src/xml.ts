import { RemoteRejected } from './http'
export type XmlValue = string | number | boolean | XmlValue[] | { [key: string]: XmlValue }
function escape(value: string) {
  // Braces become XML entities, so untrusted article text cannot become a native secret placeholder.
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
    .replaceAll('{', '&#123;')
    .replaceAll('}', '&#125;')
}
function encode(value: XmlValue): string {
  if (typeof value === 'string') return `<string>${escape(value)}</string>`
  if (typeof value === 'boolean') return `<boolean>${value ? '1' : '0'}</boolean>`
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new Error('invalid-xml-value')
    return `<int>${value}</int>`
  }
  if (Array.isArray(value))
    return `<array><data>${value.map((entry) => `<value>${encode(entry)}</value>`).join('')}</data></array>`
  return `<struct>${Object.entries(value)
    .map(
      ([key, entry]) =>
        `<member><name>${escape(key)}</name><value>${encode(entry)}</value></member>`,
    )
    .join('')}</struct>`
}
export function xmlCall(method: string, params: XmlValue[], credentialIndex = 1) {
  if (!/^wp\.[A-Za-z]+$/.test(method)) throw new Error('invalid-xml-method')
  const values = params.map((param) => `<param><value>${encode(param)}</value></param>`)
  values.splice(
    credentialIndex,
    0,
    '<param><value><string>{{username}}</string></value></param>',
    '<param><value><string>{{password}}</string></value></param>',
  )
  return `<?xml version="1.0" encoding="UTF-8"?><methodCall><methodName>${method}</methodName><params>${values.join('')}</params></methodCall>`
}
export function parseXml(text: string): XmlValue {
  if (text.length > 8 * 1024 * 1024 || /<!DOCTYPE|<!ENTITY/i.test(text))
    throw new Error('invalid-response')
  const document = new DOMParser().parseFromString(text, 'text/xml')
  if (
    document.querySelector('parsererror') ||
    document.documentElement.tagName !== 'methodResponse'
  )
    throw new Error('invalid-response')
  const fault = document.querySelector('methodResponse > fault')
  const value =
    fault?.querySelector(':scope > value') ??
    document.querySelector('methodResponse > params > param > value')
  if (!value) throw new Error('invalid-response')
  let count = 0
  function read(node: Element, depth: number): XmlValue {
    if (++count > 100_000 || depth > 32) throw new Error('invalid-response')
    const child = node.firstElementChild
    if (!child) return node.textContent ?? ''
    const content = child.textContent ?? ''
    if (child.tagName === 'string' || child.tagName === 'dateTime.iso8601') return content
    if (child.tagName === 'int' || child.tagName === 'i4') {
      if (!/^-?\d+$/.test(content) || !Number.isSafeInteger(Number(content)))
        throw new Error('invalid-response')
      return Number(content)
    }
    if (child.tagName === 'boolean') {
      if (content !== '0' && content !== '1') throw new Error('invalid-response')
      return content === '1'
    }
    if (child.tagName === 'array')
      return [...child.querySelectorAll(':scope > data > value')].map((value) =>
        read(value, depth + 1),
      )
    if (child.tagName === 'struct') {
      const result: Record<string, XmlValue> = Object.create(null)
      for (const member of child.children) {
        const name = member.querySelector(':scope > name')?.textContent
        const item = member.querySelector(':scope > value')
        if (
          !name ||
          !item ||
          Object.hasOwn(result, name) ||
          ['__proto__', 'constructor', 'prototype'].includes(name)
        )
          throw new Error('invalid-response')
        result[name] = read(item, depth + 1)
      }
      return result
    }
    throw new Error('invalid-response')
  }
  const result = read(value, 0)
  if (fault) {
    const code =
      result && typeof result === 'object' && !Array.isArray(result) ? result.faultCode : undefined
    if (code === 401 || code === 403 || code === 404) throw new RemoteRejected(code)
    throw new Error('remote-xml-fault')
  }
  return result
}
