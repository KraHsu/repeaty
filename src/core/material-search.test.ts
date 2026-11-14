import { expect, it } from 'vitest'
import type { MaterialSearchPage } from '@repeaty/plugin-api'
import { MaterialKnowledgeIndex, parseSynonymGroups, type WikiContext } from './material-search'
import { installWikiLinks, parseWikiLinks, resolveWikiTarget, stableWikiLink } from './wiki-links'
import MarkdownIt from 'markdown-it'

function index() {
  const value = new MaterialKnowledgeIndex()
  const docs = [
    {
      id: 'first',
      mediaId: 'v1',
      title: '重复标题',
      format: 'markdown' as const,
      text: '前言 😊\n\n间隔重复帮助记忆。[[source:other|另一本]]\n`[[ignored]]`',
    },
    {
      id: 'second',
      mediaId: 'v2',
      title: '重复标题',
      format: 'plain' as const,
      text: 'Different topic spaced repetition supports recall.',
    },
    {
      id: 'other',
      mediaId: 'v3',
      title: 'Renamed',
      format: 'markdown' as const,
      text: '[[重复标题]] and [[source:first|old name]]',
    },
  ]
  value.handle({ type: 'sync', sources: docs })
  for (const document of docs) value.handle({ type: 'put', document })
  return { value, docs }
}
it('matches title and body terms, expands only requested synonyms, and binds exact UTF16 locations', () => {
  const { value, docs } = index()
  const search = (text: string, expand = true) =>
    value.handle({
      type: 'search',
      text,
      expand,
      groups: parseSynonymGroups('间隔重复, spaced repetition'),
      offset: 0,
      limit: 20,
    }) as MaterialSearchPage
  expect(
    search('间隔重复')
      .hits.map((hit) => hit.sourceId)
      .sort(),
  ).toEqual(['first', 'second'])
  expect(search('间隔重复', false).hits.map((hit) => hit.sourceId)).toEqual(['first'])
  expect(search('重复标题 记忆').hits.map((hit) => hit.sourceId)).toEqual(['first'])
  expect(search('"spaced repetition"').hits).toHaveLength(2)
  const hit = search('😊', false).hits[0]!
  expect(hit.locator).toMatchObject({
    kind: 'text',
    versionId: 'v1',
    start: 3,
    end: 5,
    quote: '😊',
  })
  value.handle({ type: 'sync', sources: [{ ...docs[0]!, title: 'New title' }, docs[1]!, docs[2]!] })
  expect(search('New').hits[0]!.title).toBe('New title')
  value.handle({ type: 'sync', sources: [docs[1]!, docs[2]!] })
  expect(search('记忆').hits).toEqual([])
})
it('keeps version changes unsearchable until their new immutable body is supplied', () => {
  const { value, docs } = index()
  value.handle({ type: 'sync', sources: [{ ...docs[0]!, mediaId: 'next' }] })
  expect(() =>
    value.handle({ type: 'search', text: '记忆', groups: [], expand: false, offset: 0, limit: 20 }),
  ).toThrow('尚未完整')
  expect(() => value.handle({ type: 'put', document: docs[0]! })).toThrow('已变化')
  value.handle({ type: 'put', document: { ...docs[0]!, mediaId: 'next', text: 'replacement' } })
  expect(
    (
      value.handle({
        type: 'search',
        text: '记忆',
        groups: [],
        expand: false,
        offset: 0,
        limit: 20,
      }) as MaterialSearchPage
    ).hits,
  ).toEqual([])
})
it('preserves stable links across renames and reports ambiguous backlinks rather than choosing a title arbitrarily', () => {
  const { value, docs } = index()
  const current = value.handle({ type: 'context', sourceId: 'first' }) as WikiContext
  expect(current.outgoing[0]!.candidates[0]!.title).toBe('Renamed')
  expect(current.incoming).toHaveLength(2)
  expect(current.incoming.map((entry) => entry.ambiguous)).toEqual([true, false])
  const removed = [docs[0]!, docs[1]!]
  value.handle({ type: 'sync', sources: removed })
  expect(
    (value.handle({ type: 'context', sourceId: 'first' }) as WikiContext).outgoing[0]!.candidates,
  ).toEqual([])
  value.handle({ type: 'sync', sources: docs })
  value.handle({ type: 'put', document: docs[2]! })
  expect(
    (value.handle({ type: 'context', sourceId: 'first' }) as WikiContext).outgoing[0]!
      .candidates[0]!.sourceId,
  ).toBe('other')
})
it('validates synonym duplicates and never uses supplied text as regular expression syntax', () => {
  expect(() => parseSynonymGroups('A, a')).toThrow('重复')
  expect(() => parseSynonymGroups('one, two\ntwo, three')).toThrow('重复')
  expect(() => parseSynonymGroups('single')).toThrow('至少')
  expect(parseSynonymGroups('')).toEqual([])
  const { value } = index()
  expect(
    (
      value.handle({
        type: 'search',
        text: '.*',
        groups: [],
        expand: false,
        offset: 0,
        limit: 20,
      }) as MaterialSearchPage
    ).hits,
  ).toEqual([])
})
it('extracts only prose Wiki references, handles escaped delimiters, and supplies inline label offsets', () => {
  const raw =
    '[[Title]] `[[code]]` \\[[escaped]]\n```js\n[[fenced]]\n```\n<a title="[[attribute]]">[[Visible|Caption]]</a>\n<!--[[comment]]-->\n<style>[[style]]</style>'
  expect(parseWikiLinks(raw).map((link) => link.target)).toEqual(['Title', 'Visible'])
  const md = new MarkdownIt().use(installWikiLinks)
  const token = md
    .parseInline('before [[ source:x | Caption ]] after', {})[0]!
    .children!.find((item) => item.type === 'wiki_link')!
  expect(token.meta).toEqual({ target: 'source:x', labelStart: 21, labelEnd: 28 })
  expect(stableWikiLink({ id: 'id with spaces', title: 'One [title]' })).toBe(
    '[[source:id%20with%20spaces|One  title]]',
  )
  expect(
    resolveWikiTarget('source:id%20with%20spaces', [{ id: 'id with spaces', title: 'New name' }]),
  ).toHaveLength(1)
})
