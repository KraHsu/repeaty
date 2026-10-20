import { describe, expect, it, vi } from 'vitest'
import { BlobReader, BlobWriter, ZipReader, ZipWriter } from '@zip.js/zip.js'
import { exportArchive, parseArchive, parseBackupFile } from './archive'
import { fixture, input, now } from './test-fixtures'
import { saveNote } from './model'
import { exportBackup } from './backups'

function sample() {
  const library = fixture({
    front: '长文本 with Unicode, quotes " and line breaks\n'.repeat(300).slice(0, 10_000),
    back: '答案\n'.repeat(2500),
    format: 'markdown',
  })
  const blob = new Blob(['unique-original-media-payload'], { type: 'image/png' })
  const meta = {
    id: 'image',
    name: '学习.png',
    type: 'image/png' as const,
    size: blob.size,
    createdAt: now.toISOString(),
  }
  library.media.push(meta)
  library.notes[0]!.frontMedia = [meta.id]
  return { library, blob }
}
async function rewrite(blob: Blob, omit: string, extra = false) {
  const source = new ZipReader(new BlobReader(blob), { useWebWorkers: false })
  const writer = new BlobWriter(),
    zip = new ZipWriter(writer, { useWebWorkers: false })
  for (const entry of await source.getEntries()) {
    if (!entry.directory && entry.filename !== omit)
      await zip.add(entry.filename, new BlobReader(await entry.getData(new BlobWriter())))
  }
  if (extra) await zip.add('unexpected.bin', new BlobReader(new Blob(['extra'])))
  await zip.close()
  await source.close()
  return writer.getData()
}

describe('portable binary archives', () => {
  it.each([3, 4, 5, 6, 7, 8])(
    'reads old archives with library v%s and no sources',
    async (libraryVersion) => {
      const library = fixture()
      const source = new ZipReader(
        new BlobReader((await exportArchive(library, async () => undefined))!),
      )
      const output = new BlobWriter()
      const writer = new ZipWriter(output, { useWebWorkers: false })
      for (const entry of await source.getEntries()) {
        if (entry.directory) continue
        let blob = await entry.getData(new BlobWriter())
        if (entry.filename === 'manifest.json') {
          const manifest = JSON.parse(await blob.text())
          manifest.version = libraryVersion >= 6 ? libraryVersion - 3 : libraryVersion === 5 ? 2 : 1
          manifest.libraryVersion = libraryVersion
          delete manifest.counts.sources
          delete manifest.parts.sources
          delete manifest.counts.practices
          delete manifest.counts.attempts
          delete manifest.parts.practices
          delete manifest.parts.attempts
          blob = new Blob([JSON.stringify(manifest)])
        }
        await writer.add(entry.filename, new BlobReader(blob))
      }
      await writer.close()
      await source.close()
      expect((await parseArchive(await output.getData())).library).toEqual(library)
    },
  )
  it('round-trips 10000-character text and exact original media without Base64', async () => {
    const { library, blob } = sample()
    const archive = (await exportArchive(library, async () => blob))!
    const restored = await parseArchive(archive)
    expect(restored.library).toEqual(library)
    expect(await restored.assets[0]!.blob.arrayBuffer()).toEqual(await blob.arrayBuffer())
    const reader = new ZipReader(new BlobReader(archive))
    const media = (await reader.getEntries()).find((entry) => entry.filename === 'media/0.bin')!
    expect(media.uncompressedSize).toBe(blob.size)
    expect(media.compressionMethod).toBe(0)
    await reader.close()
  })
  it('writes directly to a stream and aborts partial output on cancellation', async () => {
    const { library, blob } = sample()
    const chunks: Uint8Array<ArrayBuffer>[] = []
    const writable = new WritableStream<Uint8Array>({
      write: (chunk) => {
        chunks.push(new Uint8Array(chunk))
      },
    })
    expect(await exportArchive(library, async () => blob, { writable })).toBeUndefined()
    expect((await parseArchive(new Blob(chunks))).library).toEqual(library)
    const controller = new AbortController(),
      abort = vi.fn()
    await expect(
      exportArchive(library, async () => blob, {
        writable: new WritableStream({ abort }),
        signal: controller.signal,
        progress: () => controller.abort(),
      }),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(abort).toHaveBeenCalledOnce()
  })
  it('rejects missing, unexpected or corrupt entries before any restore is possible', async () => {
    const { library, blob } = sample()
    const archive = (await exportArchive(library, async () => blob))!
    await expect(parseArchive(await rewrite(archive, 'media/0.bin'))).rejects.toThrow('不完整')
    await expect(parseArchive(await rewrite(archive, '', true))).rejects.toThrow('不完整')
    const bytes = new Uint8Array(await archive.arrayBuffer())
    const index = Buffer.from(bytes).indexOf('unique-original-media-payload')
    expect(index).toBeGreaterThan(0)
    bytes[index + 10] = bytes[index + 10]! ^ 0xff
    await expect(parseArchive(new Blob([bytes]))).rejects.toThrow('损坏')
    await expect(exportArchive(library, async () => undefined)).rejects.toThrow('缺失或损坏')
  })
  it('splits long text into bounded records and retains exact order across parts', async () => {
    let library = fixture()
    const front = '长文本\n'.repeat(2400),
      back = 'Long answer with spaces\n'.repeat(400)
    for (let i = 0; i < 70; i++)
      library = saveNote(
        library,
        { ...input, front: `${i}\n${front}`, back },
        undefined,
        false,
        now,
      )
    const archive = (await exportArchive(library, async () => undefined))!
    const reader = new ZipReader(new BlobReader(archive))
    const parts = (await reader.getEntries()).filter((entry) =>
      entry.filename.startsWith('data/notes/'),
    )
    expect(parts.length).toBeGreaterThan(1)
    expect(parts.every((entry) => entry.uncompressedSize <= 1024 * 1024)).toBe(true)
    expect((await parseArchive(archive)).library).toEqual(library)
    await reader.close()
  })
  it('imports legacy JSON and rejects canceled imports', async () => {
    const { library, blob } = sample()
    const old = new File([await exportBackup(library, async () => blob)], 'old.json')
    expect((await parseBackupFile(old)).library).toEqual(library)
    const controller = new AbortController()
    controller.abort()
    await expect(parseBackupFile(old, { signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    })
  })
})
