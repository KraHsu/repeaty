import { BlobReader, BlobWriter, ZipReader, ZipWriter, type FileEntry } from '@zip.js/zip.js'
import { z } from 'zod'
import { msg, LocalizedError } from '../i18n'
import { emptyLibrary, librarySchema, MAX_BACKUP_BYTES, type Library } from './model'
import { parseBackup, type BackupData } from './backups'
import { hasAttemptBody, type Attempt } from './practice-data'

const kinds = [
  'decks',
  'notes',
  'cards',
  'reviews',
  'media',
  'savedSearches',
  'practices',
  'attempts',
  'sources',
  'materialReceipts',
  'materialFolders',
] as const
const MB = 1024 * 1024
export const MAX_ARCHIVE_BYTES = 2 * 1024 * MB
const PART_BYTES = MB
const MAX_PART_BYTES = 8 * MB
const countSchema = z.object({
  materialFolders: z.number().int().min(0).max(10_000).default(0),
  materialReceipts: z.number().int().min(0).max(100_000).default(0),
  sources: z.number().int().min(0).max(10_000).default(0),
  decks: z.number().int().min(0).max(1000),
  notes: z.number().int().min(0).max(100_000),
  cards: z.number().int().min(0).max(200_000),
  reviews: z.number().int().min(0).max(500_000),
  media: z.number().int().min(0).max(100_000),
  savedSearches: z.number().int().min(0).max(100),
  practices: z.number().int().min(0).max(100_000).default(0),
  attempts: z.number().int().min(0).max(500_000).default(0),
})
const manifestSchema = z
  .object({
    format: z.literal('repeaty-archive'),
    version: z.union([
      z.literal(1),
      z.literal(2),
      z.literal(3),
      z.literal(4),
      z.literal(5),
      z.literal(6),
      z.literal(7),
      z.literal(8),
      z.literal(9),
      z.literal(10),
      z.literal(11),
      z.literal(12),
    ]),
    libraryVersion: z.union([
      z.literal(3),
      z.literal(4),
      z.literal(5),
      z.literal(6),
      z.literal(7),
      z.literal(8),
      z.literal(9),
      z.literal(10),
      z.literal(11),
      z.literal(12),
      z.literal(13),
      z.literal(14),
      z.literal(15),
    ]),
    counts: countSchema,
    parts: countSchema,
  })
  .refine((manifest) =>
    manifest.version === 12
      ? manifest.libraryVersion === 15
      : manifest.version === 11
        ? manifest.libraryVersion === 14
        : manifest.version === 10
          ? manifest.libraryVersion === 13
          : manifest.version === 9
            ? manifest.libraryVersion === 12
            : manifest.version === 8
              ? manifest.libraryVersion === 11
              : manifest.version === 7
                ? manifest.libraryVersion === 10
                : manifest.version === 6
                  ? manifest.libraryVersion === 9
                  : manifest.version === 5
                    ? manifest.libraryVersion === 8
                    : manifest.version === 4
                      ? manifest.libraryVersion === 7
                      : manifest.version === 3
                        ? manifest.libraryVersion === 6
                        : manifest.counts.sources === 0 &&
                          manifest.parts.sources === 0 &&
                          (manifest.version === 2
                            ? manifest.libraryVersion === 5
                            : manifest.libraryVersion < 5 &&
                              manifest.counts.practices === 0 &&
                              manifest.counts.attempts === 0 &&
                              manifest.parts.practices === 0 &&
                              manifest.parts.attempts === 0),
  )
export interface TransferOptions {
  signal?: AbortSignal
  progress?: (percent: number) => void
}
const failure = () => new LocalizedError(msg('备份包损坏、内容不完整或版本不兼容。'))
const partPath = (kind: string, index: number) => `data/${kind}/${index}.ndjson`
const mediaPath = (index: number) => `media/${index}.bin`

/** NDJSON parts stay bounded; original binary media never pass through Base64. */
export async function exportArchive(
  library: Library,
  getMedia: (id: string) => Promise<Blob | undefined>,
  options: TransferOptions & {
    writable?: WritableStream<Uint8Array>
    readAttempts?: (offset: number) => Promise<Attempt[]>
  } = {},
): Promise<Blob | undefined> {
  options.signal?.throwIfAborted()
  const fallback = options.writable ? undefined : new BlobWriter('application/zip')
  const destination = (options.writable ?? fallback!.writable).getWriter()
  let written = 0
  const output = new WritableStream<Uint8Array>({
    async write(chunk) {
      written += chunk.byteLength
      if (written > MAX_ARCHIVE_BYTES) throw new LocalizedError(msg('备份包不能超过 2 GB。'))
      await destination.write(chunk)
    },
    close: () => destination.close(),
    abort: (reason) => destination.abort(reason),
  })
  const writer = new ZipWriter(output, { useWebWorkers: false, bufferedWrite: false })
  const counts = Object.fromEntries(kinds.map((kind) => [kind, library[kind].length])) as z.infer<
    typeof countSchema
  >
  const parts = Object.fromEntries(kinds.map((kind) => [kind, 0])) as typeof counts
  const total = kinds.reduce((sum, kind) => sum + library[kind].length, 0) + library.media.length
  let complete = 0,
    expandedBytes = 0
  const encoder = new TextEncoder()
  async function add(path: string, blob: Blob, level: number) {
    options.signal?.throwIfAborted()
    expandedBytes += blob.size
    if (expandedBytes > MAX_ARCHIVE_BYTES) throw new LocalizedError(msg('备份包不能超过 2 GB。'))
    await writer.add(path, new BlobReader(blob), { level, signal: options.signal })
  }
  try {
    for (const kind of kinds) {
      let lines: string[] = [],
        size = 0
      const flush = async () => {
        if (!lines.length) return
        await add(
          partPath(kind, parts[kind]++),
          new Blob(lines, { type: 'application/x-ndjson' }),
          6,
        )
        complete += lines.length
        options.progress?.(Math.min(99, (complete / Math.max(1, total)) * 100))
        lines = []
        size = 0
      }
      let bodyBatch: Attempt[] = [],
        bodyPosition = 0,
        offset = 0
      for (const stored of library[kind]) {
        options.signal?.throwIfAborted()
        let record = stored
        if (kind === 'attempts' && options.readAttempts) {
          if (bodyPosition === bodyBatch.length) {
            bodyBatch = await options.readAttempts(offset)
            bodyPosition = 0
            if (!bodyBatch.length || offset + bodyBatch.length > library.attempts.length)
              throw failure()
          }
          record = bodyBatch[bodyPosition++]!
          if (record.id !== stored.id) throw failure()
          offset++
        }
        if (kind === 'attempts' && !hasAttemptBody(record as Attempt)) throw failure()
        const line = JSON.stringify(record) + '\n',
          bytes = encoder.encode(line).length
        if (bytes > MAX_PART_BYTES) throw failure()
        if (size + bytes > PART_BYTES) await flush()
        lines.push(line)
        size += bytes
      }
      await flush()
    }
    for (let index = 0; index < library.media.length; index++) {
      const meta = library.media[index]!,
        blob = await getMedia(meta.id)
      if (!blob || blob.size !== meta.size || blob.type !== meta.type)
        throw new LocalizedError(msg('无法导出：附件「{p0}」缺失或损坏。', { p0: meta.name }))
      await add(mediaPath(index), blob, 0)
      options.progress?.(Math.min(99, (++complete / Math.max(1, total)) * 100))
    }
    await add(
      'manifest.json',
      new Blob([
        JSON.stringify({
          format: 'repeaty-archive',
          version: 12,
          libraryVersion: 15,
          counts,
          parts,
        }),
      ]),
      0,
    )
    options.signal?.throwIfAborted()
    await writer.close()
    options.progress?.(100)
    return fallback?.getData()
  } catch (error) {
    await destination.abort(error).catch(() => {})
    throw error
  } finally {
    destination.releaseLock()
  }
}

export async function parseArchive(file: Blob, options: TransferOptions = {}): Promise<BackupData> {
  if (file.size > MAX_ARCHIVE_BYTES) throw new LocalizedError(msg('备份包不能超过 2 GB。'))
  const reader = new ZipReader(new BlobReader(file), {
    useWebWorkers: false,
    strictness: 'strict',
    checkCrc32: true,
    checkOverlappingEntry: true,
  })
  let expandedBytes = 0
  try {
    options.signal?.throwIfAborted()
    const entries = new Map<string, FileEntry>()
    for await (const entry of reader.getEntriesGenerator()) {
      if (
        entry.directory ||
        entry.encrypted ||
        entries.has(entry.filename) ||
        entries.size > 200_000
      )
        throw failure()
      expandedBytes += entry.uncompressedSize
      if (!Number.isSafeInteger(expandedBytes) || expandedBytes > MAX_ARCHIVE_BYTES)
        throw new LocalizedError(msg('备份包不能超过 2 GB。'))
      entries.set(entry.filename, entry)
    }
    async function read(path: string, maxBytes: number, type = 'application/octet-stream') {
      options.signal?.throwIfAborted()
      const entry = entries.get(path)
      if (!entry || entry.uncompressedSize > maxBytes) throw failure()
      const chunks: Uint8Array<ArrayBuffer>[] = []
      let size = 0
      await entry.getData(
        new WritableStream<Uint8Array>({
          write(chunk) {
            size += chunk.byteLength
            if (size > maxBytes) throw failure()
            chunks.push(new Uint8Array(chunk))
          },
        }),
        { signal: options.signal },
      )
      if (size !== entry.uncompressedSize) throw failure()
      return new Blob(chunks, { type })
    }
    const manifest = manifestSchema.parse(
      JSON.parse(await (await read('manifest.json', 64 * 1024)).text()),
    )
    const expected = new Set(['manifest.json'])
    for (const kind of kinds) {
      if (manifest.parts[kind] > manifest.counts[kind]) throw failure()
      for (let i = 0; i < manifest.parts[kind]; i++) expected.add(partPath(kind, i))
    }
    for (let i = 0; i < manifest.counts.media; i++) expected.add(mediaPath(i))
    if (expected.size !== entries.size || [...entries.keys()].some((path) => !expected.has(path)))
      throw failure()
    const library = emptyLibrary()
    let complete = 1
    for (const kind of kinds) {
      const records: unknown[] = []
      for (let i = 0; i < manifest.parts[kind]; i++) {
        const text = await (await read(partPath(kind, i), MAX_PART_BYTES)).text()
        for (const line of text.split('\n')) {
          if (!line) continue
          records.push(JSON.parse(line))
          if (records.length > manifest.counts[kind]) throw failure()
        }
        options.progress?.((++complete / expected.size) * 100)
      }
      if (records.length !== manifest.counts[kind]) throw failure()
      ;(library[kind] as unknown[]) = records
    }
    const validated = librarySchema.parse(library)
    const assets: BackupData['assets'] = []
    for (let i = 0; i < validated.media.length; i++) {
      const meta = validated.media[i]!,
        blob = await read(mediaPath(i), meta.size, meta.type)
      if (blob.size !== meta.size) throw failure()
      assets.push({ meta, blob })
      options.progress?.((++complete / expected.size) * 100)
    }
    options.signal?.throwIfAborted()
    options.progress?.(100)
    return { library: validated, assets }
  } catch (error) {
    if (options.signal?.aborted) throw options.signal.reason
    if (error instanceof LocalizedError) throw error
    throw failure()
  } finally {
    await reader.close()
  }
}

export async function parseBackupFile(
  file: File,
  options: TransferOptions = {},
): Promise<BackupData> {
  options.signal?.throwIfAborted()
  if (file.name.toLowerCase().endsWith('.json')) {
    if (file.size > MAX_BACKUP_BYTES) throw new LocalizedError(msg('备份文件不能超过 100 MB。'))
    const result = parseBackup(await file.text())
    options.signal?.throwIfAborted()
    return result
  }
  return parseArchive(file, options)
}
