import type { MaterialSearchHit, MaterialSearchPage } from '@repeaty/plugin-api'
import { characterBoundary } from './source-data'
import { parseWikiLinks, resolveWikiTarget, type WikiLink } from './wiki-links'

export type SynonymGroups = string[][]
export const MAX_INDEX_CHARACTERS = 32_000_000
export function parseSynonymGroups(text: string): SynonymGroups {
  if (text.length > 50_000) throw new Error('同义词规则过长。')
  const groups: SynonymGroups = [],
    used = new Set<string>()
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue
    const group = line.split(/[,，]/).map((value) => value.trim())
    if (
      group.length < 2 ||
      group.length > 20 ||
      group.some((term) => !term || term.length > 100 || /["\[\]]/.test(term))
    )
      throw new Error('每行至少两个词，用逗号分隔；每个词最多 100 字。')
    for (const term of group) {
      const key = term.normalize('NFKC').toLocaleLowerCase()
      if (used.has(key)) throw new Error('同义词重复或出现在多个分组中。')
      used.add(key)
    }
    groups.push(group)
  }
  if (groups.length > 200) throw new Error('同义词最多 200 组。')
  return groups
}
export function searchTerms(query: string, groups: SynonymGroups, expand: boolean) {
  const terms = (query.match(/"[^"]+"|[^\s"]+/g) ?? []).map((term) => term.replace(/^"|"$/g, ''))
  if (!terms.length || query.length > 500 || terms.length > 20)
    throw new Error('请输入不超过 500 字的搜索词。')
  const fold = (term: string) => term.normalize('NFKC').toLocaleLowerCase()
  return terms.map((term) =>
    expand
      ? (groups.find((group) => group.some((other) => fold(other) === fold(term))) ?? [term])
      : [term],
  )
}
const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
function match(text: string, variants: string[]) {
  return new RegExp(variants.map(escaped).join('|'), 'iu').exec(text)
}
export interface IndexedMaterial {
  id: string
  mediaId: string
  title: string
  format: 'plain' | 'markdown'
}
export interface IndexedDocument extends IndexedMaterial {
  text: string
}
export interface WikiContext {
  outgoing: { link: WikiLink; candidates: MaterialSearchHit[] }[]
  incoming: { source: MaterialSearchHit; label: string; ambiguous: boolean }[]
}
export type KnowledgeRequest =
  | { type: 'sync'; sources: IndexedMaterial[] }
  | { type: 'put'; document: IndexedDocument }
  | {
      type: 'search'
      text: string
      groups: SynonymGroups
      expand: boolean
      offset: number
      limit: number
    }
  | { type: 'context'; sourceId: string }
  | { type: 'preview'; sourceId: string }
  | { type: 'clear' }

/** Rebuildable derived state, owned by one Worker. Original text remains in the repository. */
export class MaterialKnowledgeIndex {
  private metadata = new Map<string, IndexedMaterial>()
  private documents = new Map<string, IndexedDocument>()
  private links = new Map<string, WikiLink[]>()
  private characters = 0
  private hit(source: IndexedMaterial, text = '', start = 0, length = 0): MaterialSearchHit {
    const from = characterBoundary(text, Math.max(0, start - 60))
    const to = characterBoundary(text, Math.min(text.length, start + Math.max(length, 100) + 60))
    return {
      sourceId: source.id,
      versionId: source.mediaId,
      title: source.title,
      snippet: `${from ? '…' : ''}${text.slice(from, to).replace(/\s+/gu, ' ').trim()}${to < text.length ? '…' : ''}`,
      ...(length > 0
        ? {
            locator: {
              schemaVersion: 1 as const,
              kind: 'text' as const,
              sourceId: source.id,
              versionId: source.mediaId,
              start,
              end: start + length,
              quote: text.slice(start, start + length),
            },
          }
        : {}),
    }
  }
  handle(request: KnowledgeRequest): unknown {
    if (request.type === 'clear') {
      this.metadata.clear()
      this.documents.clear()
      this.links.clear()
      this.characters = 0
      return
    }
    if (request.type === 'sync') {
      this.metadata = new Map(request.sources.map((source) => [source.id, source]))
      for (const [id, doc] of this.documents) {
        const current = this.metadata.get(id)
        if (current?.mediaId !== doc.mediaId) {
          this.characters -= doc.text.length
          this.documents.delete(id)
          this.links.delete(id)
        } else Object.assign(doc, current)
      }
      return
    }
    if (request.type === 'put') {
      const doc = request.document
      if (this.metadata.get(doc.id)?.mediaId !== doc.mediaId)
        throw new Error('材料已变化，请重新搜索。')
      const characters =
        this.characters - (this.documents.get(doc.id)?.text.length ?? 0) + doc.text.length
      if (characters > MAX_INDEX_CHARACTERS)
        throw new Error('材料检索超过本次支持的 3200 万字，请分库整理。')
      this.characters = characters
      this.documents.set(doc.id, doc)
      this.links.set(doc.id, doc.format === 'markdown' ? parseWikiLinks(doc.text) : [])
      return
    }
    if (request.type === 'preview') {
      const source = this.metadata.get(request.sourceId),
        doc = this.documents.get(request.sourceId)
      return source ? this.hit(source, doc?.text) : undefined
    }
    if (request.type === 'context') return this.context(request.sourceId)
    const terms = searchTerms(request.text, request.groups, request.expand)
    const hits: { hit: MaterialSearchHit; score: number }[] = []
    for (const source of this.metadata.values()) {
      const text = this.documents.get(source.id)?.text
      if (text === undefined) throw new Error('检索索引尚未完整，请重建后重试。')
      let first: RegExpExecArray | null = null,
        score = 0,
        eligible = true
      for (const term of terms) {
        const heading = match(source.title, term),
          body = match(text, term)
        if (!heading && !body) {
          eligible = false
          break
        }
        if (heading) score += 10
        if (body && (!first || body.index < first.index)) first = body
      }
      if (eligible)
        hits.push({ hit: this.hit(source, text, first?.index, first?.[0].length), score })
    }
    hits.sort(
      (a, b) =>
        b.score - a.score ||
        a.hit.title.localeCompare(b.hit.title) ||
        a.hit.sourceId.localeCompare(b.hit.sourceId),
    )
    const offset = Math.max(0, request.offset),
      limit = Math.max(1, Math.min(100, request.limit))
    return {
      hits: hits.slice(offset, offset + limit).map((entry) => entry.hit),
      ...(offset + limit < hits.length ? { nextCursor: String(offset + limit) } : {}),
    } satisfies MaterialSearchPage
  }
  private context(id: string): WikiContext {
    const sources = [...this.metadata.values()]
    const outgoing = (this.links.get(id) ?? []).map((link) => ({
      link,
      candidates: resolveWikiTarget(link.target, sources).map((source) =>
        this.hit(source, this.documents.get(source.id)?.text),
      ),
    }))
    const incoming: WikiContext['incoming'] = []
    for (const [sourceId, links] of this.links) {
      const source = this.metadata.get(sourceId)!
      for (const link of links) {
        const targets = resolveWikiTarget(link.target, sources)
        if (targets.some((target) => target.id === id))
          incoming.push({
            source: this.hit(
              source,
              this.documents.get(sourceId)!.text,
              link.start,
              link.end - link.start,
            ),
            label: link.label,
            ambiguous: targets.length > 1,
          })
      }
    }
    return { outgoing, incoming }
  }
}
