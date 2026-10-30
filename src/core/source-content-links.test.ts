import { expect, it } from 'vitest'
import { prepareSource } from './sources'
import { sourceContentLinks, sourceAnchorOffset } from './source-content-links'
import { sourceAtVersion } from './source-data'
import { renderMarkdown, renderReadingMarkdown } from './content'

function fixture() {
  const { source } = prepareSource({ title: 'From', content: 'body', format: 'markdown', url: '' })
  source.binding = {
    connectionId: 'connection',
    key: 'A.md',
    fingerprint: 'a'.repeat(64),
    acceptedMediaId: source.mediaId,
  }
  source.document = {
    schemaVersion: 1,
    providerId: 'obsidian',
    format: 'markdown',
    originalMediaId: source.mediaId,
    resources: [{ path: 'assets/图.png', mediaId: 'image-old' }],
  }
  const other = { ...source, id: 'other', binding: { ...source.binding, key: 'B.md' } }
  return { source, other }
}
it('resolves only same-connection identities and current document resources', () => {
  const { source, other } = fixture()
  const text =
    '[B](repeaty-source:B.md#Section) ![图](repeaty-resource:assets/%E5%9B%BE.png) [unknown](repeaty-source:missing)'
  const result = sourceContentLinks(source, text, [other])
  expect(result.links.get('repeaty-source:B.md#Section')).toEqual({
    sourceId: 'other',
    anchor: 'Section',
  })
  expect(result.links.size).toBe(1)
  expect(result.resources.get('repeaty-resource:assets/%E5%9B%BE.png')?.mediaId).toBe('image-old')
  expect(
    sourceContentLinks(source, text, [
      { ...other, binding: { ...other.binding, connectionId: 'foreign' } },
    ]).links.size,
  ).toBe(0)
  expect(sourceContentLinks(undefined, text, [other]).resources.size).toBe(0)
})
it('old snapshots resolve their own resource identities instead of silently rebinding current media', () => {
  const { source } = fixture()
  const previous = {
    title: source.title,
    url: '',
    format: source.format,
    mediaId: source.mediaId,
    characters: source.characters,
    acceptedAt: source.createdAt,
    document: source.document,
  }
  const current = {
    ...source,
    mediaId: 'new-text',
    versions: [previous],
    document: { ...source.document!, resources: [{ path: 'assets/图.png', mediaId: 'image-new' }] },
  }
  const snapshot = sourceAtVersion(current, source.mediaId)!
  expect(
    sourceContentLinks(snapshot, '![图](repeaty-resource:assets/%E5%9B%BE.png)').resources.get(
      'repeaty-resource:assets/%E5%9B%BE.png',
    )?.mediaId,
  ).toBe('image-old')
})
it('creates actionable markers only from host-accepted Markdown links, never raw HTML or arbitrary schemes', () => {
  const text =
    '[B](repeaty-source:B.md)\n\n<a data-source-reference="repeaty-source:B.md" href="repeaty-source:B.md">forged</a>\n\n[bad](repeaty-source:bad)'
  for (const render of [renderMarkdown, renderReadingMarkdown]) {
    const html = render(text, new Map(), { sourceLinks: new Set(['repeaty-source:B.md']) })
    expect(html.match(/data-source-reference=/g)).toHaveLength(1)
    expect(html).not.toContain('href="repeaty-source:')
    expect(render(text)).not.toContain('data-source-reference=')
  }
})
it('finds accepted heading/block anchors while ignoring fenced examples', () => {
  const text = '```md\n# Example\n```\n\n# Real Heading\nText ^block-id'
  expect(sourceAnchorOffset(text, 'Example')).toBeUndefined()
  expect(sourceAnchorOffset(text, 'real-heading')).toBe(text.indexOf('# Real'))
  expect(sourceAnchorOffset(text, '^block-id')).toBe(text.indexOf('Text'))
})
