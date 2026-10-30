import MarkdownIt from 'markdown-it'
import type { PublishingSource } from '@repeaty/plugin-api'
import type { Ledger } from './types'

const markdown = new MarkdownIt({ html: false, linkify: true, breaks: false })
const publicUrl = (url: string) => /^(https:\/\/|mailto:|#)/i.test(url)
markdown.validateLink = publicUrl
// Accept unsafe destinations while auditing, so invalid links remain visible to inspection.
const audit = new MarkdownIt({ html: true, linkify: false })
audit.validateLink = () => true
type Edit = { start: number; end: number; text: string }

function codeRanges(body: string) {
  const offsets = [0]
  for (let at = 0; at < body.length; at++) if (body[at] === '\n') offsets.push(at + 1)
  const ranges: { start: number; end: number }[] = []
  for (const token of audit.parse(body, {})) {
    if ((token.type === 'fence' || token.type === 'code_block') && token.map)
      ranges.push({ start: offsets[token.map[0]]!, end: offsets[token.map[1]] ?? body.length })
  }
  for (let at = 0; at < body.length;) {
    const block = ranges.find((range) => at >= range.start && at < range.end)
    if (block) {
      at = block.end
      continue
    }
    if (body[at] === '\\') {
      at += 2
      continue
    }
    if (body[at] !== '`') {
      at++
      continue
    }
    const run = /^`+/.exec(body.slice(at))![0]
    let end = body.indexOf(run, at + run.length)
    while (end >= 0 && (body[end - 1] === '`' || body[end + run.length] === '`'))
      end = body.indexOf(run, end + run.length)
    if (end >= 0) {
      ranges.push({ start: at, end: end + run.length })
      at = end + run.length
    } else at += run.length
  }
  return ranges
}

/** Publish only prepared content and already-public destinations, never raw internal identities. */
export function publicMarkdown(source: PublishingSource, ledger: Ledger, site: string) {
  if (source.assets.length) throw new Error('local-assets')
  const body = source.body
  const code = codeRanges(body)
  const isCode = (position: number) =>
    code.some((range) => position >= range.start && position < range.end)
  const links = new Map(source.links.map((link) => [link.reference, link]))
  const resolve = (reference: string) => {
    const link = links.get(reference)
    const binding = link && ledger.bindings[`${site}\n${link.sourceId}`]
    if (
      !link ||
      !binding?.remote ||
      binding.state !== 'ready' ||
      binding.remote.status !== 'publish'
    )
      throw new Error('local-links')
    const target = new URL(binding.remote.url)
    if (
      target.protocol !== 'https:' ||
      target.origin !== new URL(site).origin ||
      target.username ||
      target.password
    )
      throw new Error('local-links')
    if (link.fragment) target.hash = link.fragment
    return target.href
  }
  const edits: Edit[] = []
  for (const match of body.matchAll(/\[\[([^\[\]\r\n]{1,600})\]\]/g)) {
    const start = match.index
    if (isCode(start) || body[start - 1] === '\\') continue
    if (body[start - 1] === '!') throw new Error('local-assets')
    const [rawTarget = '', ...labelParts] = match[1]!.split('|')
    const target = rawTarget.trim()
    const label = (labelParts.length ? labelParts.join('|') : target).trim()
    if (!label || label.length > 200 || /^(?:source:|repeaty-)/i.test(label))
      throw new Error('local-links')
    edits.push({
      start,
      end: start + match[0].length,
      text: `[${label.replace(/[\\[\]]/g, '\\$&')}](<${resolve(target)}>)`,
    })
  }
  // Locate destinations, never occurrences of the same word in labels, prose, or code.
  for (const match of body.matchAll(/\]\([ \t\n]*|^ {0,3}\[[^\]\n]+\]:[ \t]*/gm)) {
    if (isCode(match.index)) continue
    const start = match.index + match[0].length
    const parsed = audit.helpers.parseLinkDestination(body, start, body.length)
    if (!parsed.ok || !/^repeaty-source:/i.test(parsed.str)) continue
    edits.push({ start, end: parsed.pos, text: `<${resolve(parsed.str)}>` })
  }
  let result = body
  for (const edit of edits.sort((a, b) => b.start - a.start))
    result = result.slice(0, edit.start) + edit.text + result.slice(edit.end)
  // Discourse could interpret raw HTML attributes even though the local preview escapes them.
  // Reject unsupported raw HTML rather than allow a local file or private path to be sent.
  const environment: { references?: Record<string, { href: string }> } = {}
  for (const token of audit.parse(result, environment)) {
    if (token.type === 'html_block') throw new Error('local-links')
    for (const child of token.children ?? []) {
      if (child.type === 'html_inline') throw new Error('local-links')
      const url = child.attrGet(child.type === 'image' ? 'src' : 'href')
      if (url && !publicUrl(url)) throw new Error('local-links')
    }
  }
  for (const reference of Object.values(environment.references ?? {}))
    if (!publicUrl(reference.href)) throw new Error('local-links')
  // Malformed markup and literal code must not leak internal identities or filesystem paths.
  if (/repeaty-(?:source|resource):|\[\[\s*source:|\bfile:|\b[a-z]:[\\/]|\\\\[^\s\\]/i.test(result))
    throw new Error('local-links')
  return result
}
export function renderMarkdown(body: string, plain = false) {
  return plain
    ? `<p>${markdown.utils.escapeHtml(body).replace(/\n/g, '<br>')}</p>`
    : markdown.render(body)
}
