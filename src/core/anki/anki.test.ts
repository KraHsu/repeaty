import { beforeAll, describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import initSqlJs, { type SqlJsStatic } from 'sql.js'
import { BlobReader, BlobWriter, ZipReader, ZipWriter } from '@zip.js/zip.js'
import { parseAnkiPackage } from './package'
import { convertAnkiHtml } from './html'
import { prepareAnkiImport } from './import'
import { decompressAnki } from './compression'
import { protobuf } from './protobuf'
import { ankiNoteId, MAX_APKG_BYTES } from './types'
import { fixture, now } from '../test-fixtures'
import { cardViews, librarySchema } from '../model'
import { exportArchive, parseArchive } from '../archive'
import { rekeyBackup } from '../backups'
import { reviewCard } from '../scheduler'
import { renderMarkdown } from '../content'

let SQL: SqlJsStatic
beforeAll(async () => {
  SQL = await initSqlJs()
})
async function file(format: 'legacy' | 'modern') {
  return new File([await readFile(`tests/fixtures/anki/${format}.apkg`)], `${format}.apkg`)
}
async function rewrite(
  blob: Blob,
  update: (name: string, data: Blob) => Promise<Blob | undefined>,
) {
  const reader = new ZipReader(new BlobReader(blob), { useWebWorkers: false })
  const writer = new ZipWriter(new BlobWriter(), { useWebWorkers: false })
  try {
    for (const entry of await reader.getEntries()) {
      if (entry.directory) continue
      const data = await update(entry.filename, await entry.getData(new BlobWriter()))
      if (data) await writer.add(entry.filename, new BlobReader(data))
    }
    return await writer.close()
  } finally {
    await reader.close()
  }
}

describe('Anki package import', () => {
  it.each(['legacy', 'modern'] as const)(
    'reads real Anki 26.9.3 %s exports, media, variants and reports',
    async (format) => {
      const data = await parseAnkiPackage(await file(format), SQL)
      expect(data.format).toBe(format)
      expect(data.totalNotes).toBe(7)
      expect(data.reviewCount).toBe(1)
      expect(data.notes).toHaveLength(4)
      expect(data.assets.map((asset) => [asset.meta.name, asset.meta.type])).toEqual([
        ['pixel.png', 'image/png'],
        ['voice.wav', 'audio/wav'],
      ])
      const basic = data.notes.find((note) => note.guid === 'rpt-basic')!
      expect(basic.input.front).toContain('**2 + 2**')
      expect(basic.input.front).toContain('$x^2$')
      expect(basic.input.back).toContain('中文')
      expect(basic.input.back).toContain('````\nreturn 4\n```\n````')
      expect(basic.input.tags).toEqual(['Anki', '中文'])
      expect(
        data.issues
          .filter((issue) => issue.skipped)
          .map((issue) => issue.reason)
          .sort(),
      ).toEqual(['media', 'template', 'variants'])
      expect(data.issues.filter((issue) => !issue.skipped).map((issue) => issue.reason)).toEqual([
        'active-content',
        'external-media',
      ])
      const imported = prepareAnkiImport(fixture(), data, 'deck', now)
      librarySchema.parse(imported.library)
      expect(imported.library.notes).toHaveLength(5)
      expect(imported.library.cards).toHaveLength(7)
      expect(imported.library.reviews).toHaveLength(0)
      expect(
        imported.library.cards.every(
          (card) => card.schedule.state === 0 && card.schedule.reps === 0,
        ),
      ).toBe(true)
      const cloze = cardViews(imported.library).filter(
        (card) => card.id !== 'card' && card.type === 'cloze',
      )
      expect(cloze.map((card) => card.variant)).toEqual(['cloze:1', 'cloze:2'])
      expect(cloze[0]!.cloze?.answers).toEqual(['capital'])
      expect(cloze[1]!.cloze?.answers).toEqual(['Paris'])
    },
  )

  it('keeps existing content and progress on reimport, including after full backup restore', async () => {
    const data = await parseAnkiPackage(await file('modern'), SQL)
    let { library, assets } = prepareAnkiImport(fixture(), data, 'deck', now)
    library = reviewCard(
      library,
      library.cards.find((card) => card.noteId === ankiNoteId('rpt-basic'))!.id,
      3,
      now,
    )
    const blobs = new Map(assets.map((asset) => [asset.meta.id, asset.blob]))
    const restored = rekeyBackup(
      await parseArchive((await exportArchive(library, async (id) => blobs.get(id)))!),
    )
    const next = prepareAnkiImport(
      restored.library,
      await parseAnkiPackage(await file('legacy'), SQL),
      'deck',
      now,
    )
    expect(next.library).toEqual(restored.library)
    expect(next.assets).toEqual([])
    expect(next.library.reviews).toHaveLength(1)
  })

  it('does not retain orphan attachments when a note fails conversion', async () => {
    const broken = await rewrite(await file('legacy'), async (name, blob) =>
      name === '1' ? undefined : blob,
    )
    const data = await parseAnkiPackage(broken, SQL)
    expect(data.notes.find((note) => note.guid === 'rpt-basic')).toBeUndefined()
    const used = new Set(
      data.notes.flatMap((note) => [...note.input.frontMedia, ...note.input.backMedia]),
    )
    expect(data.assets.every((asset) => used.has(asset.meta.id))).toBe(true)
  })

  it('rejects invalid zip, future package metadata, oversized files and dangerous media paths', async () => {
    await expect(parseAnkiPackage(new Blob(['broken']), SQL)).rejects.toThrow('Anki 文件损坏')
    const future = await rewrite(await file('modern'), async (name, blob) =>
      name === 'meta' ? new Blob([new Uint8Array([8, 99])]) : blob,
    )
    await expect(parseAnkiPackage(future, SQL)).rejects.toThrow('Anki 文件损坏')
    const paths = await rewrite(await file('legacy'), async (name, blob) =>
      name === 'media' ? new Blob(['{"0":"../pixel.png"}']) : blob,
    )
    await expect(parseAnkiPackage(paths, SQL)).rejects.toThrow('Anki 文件损坏')
    await expect(parseAnkiPackage({ size: MAX_APKG_BYTES + 1 } as Blob, SQL)).rejects.toThrow(
      '256 MB',
    )
    expect(() => prepareAnkiImport(fixture(), { notes: [] } as never, 'missing')).toThrow(
      '目标卡组不存在',
    )
  })
})

describe('inert HTML conversion', () => {
  it('does not execute or retain scripts, event handlers, unsafe links or remote media', () => {
    const data = convertAnkiHtml(
      '<img src="https://example.org/a.png" onerror="alert(1)"><script>bad()</script><iframe src="https://example.org"></iframe><b>Safe &amp; sound</b><a href="javascript:bad()">answer</a>',
    )
    const html = renderMarkdown(data.text)
    expect(data.active).toBe(true)
    expect(data.external).toBe(true)
    expect(data.media).toEqual([])
    expect(html).toContain('<strong>Safe &amp; sound</strong>')
    expect(html).not.toMatch(/bad\(|<script|<iframe|<img|onerror|javascript:/)
  })
  it('preserves cloze markers, literal Markdown, formulas, Unicode and encoded attachment names', () => {
    const field = convertAnkiHtml(
      '**literal** &lt;b&gt; {{c1::中文::hint}}<br>\\(x^2\\)<br>\\[a+b\\]<img src="a%20b.png">[sound:你好.wav]',
    )
    expect(field.text).toContain('\\*\\*literal\\*\\*')
    expect(field.text).toContain('{{c1::中文::hint}}')
    expect(field.text).toContain('$x^2$')
    expect(field.text).toContain('$$a+b$$')
    expect(field.media).toEqual([
      { name: 'a b.png', kind: 'image' },
      { name: '你好.wav', kind: 'audio' },
    ])
    expect(() => convertAnkiHtml('<img src="../outside.png">')).toThrow()
  })
  it('bounds malformed protobuf fields and zstd window allocations before decoding', () => {
    expect(() => protobuf(new Uint8Array([10, 100]))).toThrow()
    expect(() => protobuf(new Uint8Array([0]))).toThrow()
    expect(() => decompressAnki(new Uint8Array([0x28, 0xb5, 0x2f, 0xfd, 0, 0xf8]), 1024)).toThrow()
    expect(() =>
      decompressAnki(new Uint8Array([0x28, 0xb5, 0x2f, 0xfd, 0x20, 0, 1, 0, 0, 0]), 1024),
    ).toThrow()
  })
  it('keeps blank lines in code and reports Anki compiled LaTeX instead of importing broken markup', () => {
    expect(convertAnkiHtml('<pre>line 1\n\n\nline 4</pre>').text).toBe(
      '```\nline 1\n\n\nline 4\n```',
    )
    expect(() => convertAnkiHtml('[latex]x[/latex]')).toThrow('compiled LaTeX')
  })
})
