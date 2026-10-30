import { describe, expect, it } from 'vitest'
import { prepareBackupRestore } from './backup-restore'
import { exportBackup, parseBackup, type BackupData } from './backups'
import { exportArchive, parseArchive } from './archive'
import { fixture, now } from './test-fixtures'
import { materialFixture } from '../../tests/fixtures/material-model'
import type { RetiredNote } from '../desktop/retirement'
import { readWorkspaceMarkdown } from '../workspace/markdown'
import { validateRetiredBackup } from './retired-backup'
import { addSource, prepareSource, replaceSourceContent } from './sources'
import { retiredSourceRisk, validateRetiredSources } from './retired-updates'

const digest = async (value: string) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
async function example(): Promise<BackupData> {
  const material = materialFixture()
  const plugin = {
    id: 'visual-occlusion',
    version: 1,
    data: {},
    variants: ['one'],
    variantLocators: { one: material.locator },
  }
  const old = fixture({ type: 'plugin', plugin, excerpt: material.library.notes.at(-1)!.excerpt }),
    original = old.notes[0]!
  const blob = new Blob(['original diagram'], { type: 'image/png' }),
    image = {
      id: 'retired-image',
      name: 'image.png',
      type: 'image/png' as const,
      size: blob.size,
      createdAt: now.toISOString(),
    }
  const note = {
    ...original,
    format: 'markdown' as const,
    backMedia: [image.id],
    excerpt: material.library.notes.at(-1)!.excerpt,
    front: `正文中的 ${material.root.source.mediaId} 不应替换。`,
    back: '保留 **原样正文**。\r\n',
  }
  const raw = `\uFEFF---\r\n# 用户注释保持原样\r\ncustom:\r\n    literalId: '${material.root.source.mediaId}' # 不是身份引用\r\n    nested: ["a", {b: true}]\r\nrepeaty:\r\n  version: 1\r\n  kind: note\r\n  id: ${note.id}\r\n  type: plugin\r\n  format: markdown\r\n  deckId: ${note.deckId}\r\n  backMedia:\r\n    - id: '${image.id}' # 媒体引用注释\r\n      path: assets/${await digest('original diagram')}.png\r\n  plugin: ${JSON.stringify(plugin)}\r\n---\r\n${note.front}\r\n<!-- repeaty:answer -->\r\n${note.back}`
  const entry: RetiredNote = {
    revision: 7,
    note,
    document: {
      id: note.id,
      kind: 'note',
      path: 'notes/保留原名.md',
      raw,
      hash: await digest(raw),
    },
    cards: old.cards,
    reviews: [],
    practices: [],
    attempts: [],
    media: [image],
  }
  return {
    library: material.library,
    assets: [...material.assets, { meta: image, blob }],
    retired: [entry],
  }
}
describe('portable retired document restore', () => {
  it('keeps unversioned retired excerpts on the first snapshot through rekey and refuses removing that snapshot', async () => {
    const first = prepareSource(
      { title: 'Book', url: '', format: 'plain', content: 'original passage' },
      now,
    )
    const base = addSource(fixture(), first.source, first.asset)
    const retired: RetiredNote = {
      revision: 1,
      note: {
        ...base.notes[0]!,
        excerpt: { sourceId: first.source.id, start: 0, end: 8, quote: 'original' },
      },
      document: null,
      cards: base.cards,
      reviews: [],
      practices: [],
      attempts: [],
      media: [],
    }
    const initial = { ...base, notes: [], cards: [] }
    const changed = replaceSourceContent(
      initial,
      first.source.id,
      { title: 'Book', url: '', format: 'plain', content: 'new text' },
      now,
    )
    for (const library of [initial, changed.library]) {
      const assets = library === initial ? [first.asset] : [first.asset, changed.asset]
      const serialized = await exportBackup(
        library,
        async (id) => assets.find((asset) => asset.meta.id === id)?.blob,
        [retired],
      )
      const restored = await prepareBackupRestore(parseBackup(serialized))
      expect(restored.retired![0]!.note!.excerpt!.mediaId).toBeUndefined()
      const source = restored.library.sources[0]!,
        id = source.versions?.[0]?.mediaId ?? source.mediaId
      expect(await restored.assets.find((asset) => asset.meta.id === id)!.blob.text()).toBe(
        'original passage',
      )
    }
    const dropped = {
      ...changed.library,
      sources: changed.library.sources.map((source) => ({ ...source, versions: [] })),
    }
    expect(retiredSourceRisk(changed.library, dropped)).toBe(true)
    expect(() => validateRetiredSources(changed.library, dropped, [retired])).toThrow(
      '退役卡片引用',
    )
  })
  it('rekeys managed YAML references and hash while retaining unknown YAML, comments, paths, CRLF, BOM and exact body', async () => {
    const data = await example(),
      old = data.retired![0]!,
      read = async (id: string) => data.assets.find((asset) => asset.meta.id === id)?.blob
    const copies = [
      parseBackup(await exportBackup(data.library, read, data.retired)),
      await parseArchive((await exportArchive(data.library, read, { retired: data.retired }))!),
    ]
    for (const copy of copies) {
      const restored = await prepareBackupRestore(copy),
        entry = restored.retired![0]!,
        document = entry.document!
      expect(document.hash).toBe(await digest(document.raw))
      expect(document.hash).not.toBe(old.document!.hash)
      expect(document.raw.startsWith('\uFEFF---\r\n')).toBe(true)
      const before = readWorkspaceMarkdown(old.document!.raw),
        after = readWorkspaceMarkdown(document.raw)
      expect(after.status).toBe('managed')
      expect(before.status).toBe('managed')
      if (after.status !== 'managed' || before.status !== 'managed') throw new Error('fixture')
      expect(after.document.content).toEqual(before.document.content)
      expect(after.document.properties.custom).toEqual(before.document.properties.custom)
      expect(document.raw).toContain('# 用户注释保持原样\r\ncustom:\r\n    literalId:')
      expect(document.raw).toContain('# 媒体引用注释\r\n')
      expect(after.document.header.backMedia![0]!.path).toBe(
        before.document.header.backMedia![0]!.path,
      )
      expect(after.document.header.backMedia![0]!.id).toBe(entry.note!.backMedia[0])
      expect(after.document.header.backMedia![0]!.id).not.toBe(old.note!.backMedia[0])
      expect(after.document.header.plugin!.variantLocators!.one!.versionId).toBe(
        entry.note!.excerpt!.mediaId,
      )
      expect(entry.note!.plugin!.variantLocators!.one!.versionId).toBe(entry.note!.excerpt!.mediaId)
      const source = restored.library.sources.find(
        (source) => source.id === entry.note!.excerpt!.sourceId,
      )!
      expect(source.mediaId).toBe(entry.note!.excerpt!.mediaId)
      expect(source.document!.originalMediaId).not.toBe(
        data.library.sources[0]!.document!.originalMediaId,
      )
      expect(
        await restored.assets
          .find((asset) => asset.meta.id === source.document!.originalMediaId)!
          .blob.text(),
      ).toBe('%PDF-original-byte-preservation')
      expect(old.document!.raw).toBe(data.retired![0]!.document!.raw)
    }
  })
  it('rejects damaged document hashes, incorrect quotations, missing media and broken locator bindings before restoration', async () => {
    const data = await example()
    await expect(
      prepareBackupRestore({
        ...data,
        retired: [
          {
            ...data.retired![0]!,
            document: { ...data.retired![0]!.document!, hash: '0'.repeat(64) },
          },
        ],
      }),
    ).rejects.toThrow('校验和')
    const wrongQuote = structuredClone(data.retired!)
    wrongQuote[0]!.note!.excerpt!.quote = 'Wrong page.'
    await expect(prepareBackupRestore({ ...data, retired: wrongQuote })).rejects.toThrow('摘录')
    const missing = structuredClone(data.retired!)
    missing[0]!.note!.backMedia = ['missing-image']
    expect(() => validateRetiredBackup(data.library, missing)).toThrow('media-reference')
    const wrong = structuredClone(data.retired!)
    wrong[0]!.note!.plugin!.variantLocators!.one!.versionId = 'wrong-version'
    expect(() => validateRetiredBackup(data.library, wrong)).toThrow()
    const unknown = structuredClone(data.retired!)
    unknown[0]!.document!.raw = unknown[0]!.document!.raw.replace(
      "id: 'retired-image'",
      "id: 'missing-original-reference'",
    )
    unknown[0]!.document!.hash = await digest(unknown[0]!.document!.raw)
    await expect(prepareBackupRestore({ ...data, retired: unknown })).rejects.toThrow('原文引用')
  })
})
