import { BlobReader, ZipReader, type FileEntry } from '@zip.js/zip.js'
import type { SqlJsStatic } from 'sql.js'
import { msg, LocalizedError } from '../../i18n'
import {
  noteSchema,
  variants,
  MAX_MEDIA_BYTES,
  mediaTypes,
  type MediaUpload,
  type Media,
} from '../model'
import { ankiNoteType, readAnkiDatabase } from './database'
import { decompressAnki } from './compression'
import { convertAnkiHtml } from './html'
import { protobuf, protoNumber, protoText, protoBytes } from './protobuf'
import {
  MAX_APKG_BYTES,
  MAX_ANKI_DATABASE_BYTES,
  MAX_ANKI_EXPANDED_BYTES,
  ankiNoteId,
  type AnkiPackage,
  type AnkiIssueReason,
} from './types'

const failure = () => new LocalizedError(msg('Anki 文件损坏、格式不受支持或超过导入限制。'))
const decoder = new TextDecoder('utf-8', { fatal: true })
const extensions: Record<string, Media['type']> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  m4a: 'audio/mp4',
  webm: 'audio/webm',
  flac: 'audio/flac',
  aac: 'audio/aac',
}
interface MediaEntry {
  index: string
  size?: number
  sha1?: Uint8Array
}

function mediaType(name: string, data: Uint8Array): Media['type'] | undefined {
  const type = extensions[name.split('.').at(-1)?.toLowerCase() ?? '']
  const text = (start: number, length: number) =>
    String.fromCharCode(...data.subarray(start, start + length))
  const valid =
    type === 'image/png'
      ? data.length > 8 && data[0] === 137 && text(1, 3) === 'PNG'
      : type === 'image/jpeg'
        ? data[0] === 255 && data[1] === 216 && data[2] === 255
        : type === 'image/gif'
          ? ['GIF87a', 'GIF89a'].includes(text(0, 6))
          : type === 'image/webp'
            ? text(0, 4) === 'RIFF' && text(8, 4) === 'WEBP'
            : type === 'audio/wav'
              ? text(0, 4) === 'RIFF' && text(8, 4) === 'WAVE'
              : type === 'audio/ogg'
                ? text(0, 4) === 'OggS'
                : type === 'audio/flac'
                  ? text(0, 4) === 'fLaC'
                  : type === 'audio/mp4'
                    ? text(4, 4) === 'ftyp'
                    : type === 'audio/webm'
                      ? data[0] === 0x1a && data[1] === 0x45 && data[2] === 0xdf && data[3] === 0xa3
                      : type === 'audio/mpeg'
                        ? text(0, 3) === 'ID3' ||
                          (data[0] === 255 && ((data[1] ?? 0) & 0xe0) === 0xe0)
                        : type === 'audio/aac'
                          ? data[0] === 255 && ((data[1] ?? 0) & 0xf6) === 0xf0
                          : false
  return valid && type && (mediaTypes as readonly string[]).includes(type) ? type : undefined
}

export async function parseAnkiPackage(
  file: Blob & { name?: string },
  SQL: SqlJsStatic,
  progress?: (percent: number) => void,
): Promise<AnkiPackage> {
  if (!file.size || file.size > MAX_APKG_BYTES)
    throw new LocalizedError(msg('Anki 文件不能超过 256 MB。'))
  const reader = new ZipReader(new BlobReader(file), {
    useWebWorkers: false,
    strictness: 'strict',
    checkCrc32: true,
    checkOverlappingEntry: true,
  })
  const entries = new Map<string, FileEntry>()
  let expanded = 0
  try {
    for await (const entry of reader.getEntriesGenerator()) {
      expanded += entry.uncompressedSize
      if (
        entry.directory ||
        entry.encrypted ||
        entries.has(entry.filename) ||
        entries.size >= 20_010 ||
        !Number.isSafeInteger(expanded) ||
        expanded > MAX_ANKI_EXPANDED_BYTES ||
        /[/\\\u0000]/.test(entry.filename)
      )
        throw failure()
      entries.set(entry.filename, entry)
    }
    let readBytes = 0
    async function read(
      name: string,
      limit: number,
      compressed = false,
    ): Promise<Uint8Array<ArrayBuffer>> {
      const entry = entries.get(name)
      const inputLimit = compressed ? limit + 128 * 1024 : limit
      if (!entry || entry.uncompressedSize > inputLimit) throw failure()
      const chunks: Uint8Array<ArrayBuffer>[] = []
      let size = 0
      await entry.getData(
        new WritableStream<Uint8Array>({
          write(chunk) {
            size += chunk.length
            if (size > inputLimit) throw failure()
            chunks.push(new Uint8Array(chunk))
          },
        }),
      )
      if (size !== entry.uncompressedSize) throw failure()
      const data = new Uint8Array(size)
      let position = 0
      for (const chunk of chunks) {
        data.set(chunk, position)
        position += chunk.length
      }
      const output = compressed ? decompressAnki(data, limit) : data
      readBytes += output.length
      if (readBytes > MAX_ANKI_EXPANDED_BYTES) throw failure()
      return output
    }
    if (entries.has('collection.anki21b') && !entries.has('meta')) throw failure()
    const meta = entries.has('meta')
      ? protoNumber(protobuf(await read('meta', 1024)), 1)
      : entries.has('collection.anki21')
        ? 2
        : 1
    if (![1, 2, 3].includes(meta)) throw failure()
    const modern = meta === 3
    const data = await read(
      modern ? 'collection.anki21b' : meta === 2 ? 'collection.anki21' : 'collection.anki2',
      MAX_ANKI_DATABASE_BYTES,
      modern,
    )
    if (decoder.decode(data.subarray(0, 16)) !== 'SQLite format 3\0') throw failure()
    const db = new SQL.Database(data)
    const source = (() => {
      try {
        return readAnkiDatabase(db)
      } finally {
        db.close()
      }
    })()
    progress?.(15)
    const media = new Map<string, MediaEntry>()
    if (entries.has('media')) {
      const mapping = await read('media', 4 * 1024 * 1024, modern)
      if (modern) {
        const list = protobuf(mapping).get(1) ?? []
        if (list.length > 20_000) throw failure()
        for (const [index, value] of list.entries()) {
          if (!(value instanceof Uint8Array)) throw failure()
          const fields = protobuf(value)
          const name = protoText(fields, 1).normalize('NFC'),
            sha1 = protoBytes(fields, 3)
          if (media.has(name) || sha1.length !== 20) throw failure()
          media.set(name, { index: String(index), size: protoNumber(fields, 2), sha1 })
        }
      } else {
        const mappingData: unknown = JSON.parse(decoder.decode(mapping))
        if (
          !mappingData ||
          typeof mappingData !== 'object' ||
          Array.isArray(mappingData) ||
          Object.keys(mappingData).length > 20_000
        )
          throw failure()
        for (const [index, value] of Object.entries(mappingData)) {
          if (!/^\d{1,6}$/.test(index) || typeof value !== 'string') throw failure()
          const name = value.normalize('NFC')
          if (media.has(name)) throw failure()
          media.set(name, { index })
        }
      }
      for (const name of media.keys())
        if (
          !name ||
          name.length > 255 ||
          /[/\\\u0000-\u001f]/.test(name) ||
          name === '.' ||
          name === '..'
        )
          throw failure()
    }
    const result: AnkiPackage = {
      name: file.name ?? 'Anki',
      format: modern ? 'modern' : 'legacy',
      totalNotes: source.notes.length,
      reviewCount: source.reviewCount,
      notes: [],
      assets: [],
      issues: [],
    }
    const assets = new Map<string, MediaUpload>(),
      invalidMedia = new Set<string>(),
      seen = new Set<string>()
    async function getMedia(name: string, kind: 'image' | 'audio'): Promise<string> {
      if (invalidMedia.has(name)) throw new Error('Unsupported media')
      let asset = assets.get(name)
      if (!asset) {
        try {
          const entry = media.get(name)
          if (!entry || (entry.size !== undefined && (!entry.size || entry.size > MAX_MEDIA_BYTES)))
            throw new Error('Missing media')
          const bytes = await read(entry.index, MAX_MEDIA_BYTES, modern),
            type = mediaType(name, bytes)
          if (!type || !bytes.length || (entry.size !== undefined && entry.size !== bytes.length))
            throw new Error('Invalid media')
          if (entry.sha1) {
            const hash = new Uint8Array(await crypto.subtle.digest('SHA-1', bytes))
            if (hash.some((byte, i) => byte !== entry.sha1![i]))
              throw new Error('Media checksum mismatch')
          }
          asset = {
            meta: {
              id: crypto.randomUUID(),
              name,
              type,
              size: bytes.length,
              createdAt: new Date().toISOString(),
            },
            blob: new Blob([bytes], { type }),
          }
          assets.set(name, asset)
        } catch {
          invalidMedia.add(name)
          throw new Error('Unsupported media')
        }
      }
      if (!asset.meta.type.startsWith(`${kind}/`)) throw new Error('Invalid media kind')
      return asset.meta.id
    }
    for (const [index, original] of source.notes.entries()) {
      const model = source.models.get(original.modelId),
        type = model && ankiNoteType(model)
      let reason: AnkiIssueReason = 'template'
      try {
        if (!model || !type) throw new Error('Unsupported template')
        reason = 'fields'
        if (original.fields.length !== model.fields.length) throw new Error('Invalid fields')
        const id = ankiNoteId(original.guid)
        if (seen.has(id)) throw new Error('Duplicate Anki GUID')
        seen.add(id)
        reason = 'content'
        let front = convertAnkiHtml(original.fields[0]!),
          back = convertAnkiHtml(original.fields[1]!)
        let noteType = type
        reason = 'variants'
        if (type === 'basic' && (original.ords.length !== 1 || original.ords[0] !== 0))
          throw new Error('Invalid basic variants')
        if (type === 'reversed') {
          if (original.ords.length === 1 && [0, 1].includes(original.ords[0]!)) {
            noteType = 'basic'
            if (original.ords[0] === 1) [front, back] = [back, front]
          } else if (original.ords.length !== 2 || original.ords[0] !== 0 || original.ords[1] !== 1)
            throw new Error('Invalid reversed variants')
        }
        if (type === 'cloze') {
          const expected = variants({ type: 'cloze', front: front.text }).map(
            (variant) => Number(variant.slice(6)) - 1,
          )
          if (
            expected.length !== original.ords.length ||
            expected.some((ord, i) => ord !== original.ords[i])
          )
            throw new Error('Partial cloze variants')
        }
        reason = 'media'
        async function attachments(items: typeof front.media) {
          const ids = new Set<string>()
          if (new Set(items.map((item) => item.name)).size > 8)
            throw new Error('Too many attachments')
          for (const item of items) ids.add(await getMedia(item.name, item.kind))
          return [...ids]
        }
        const frontMedia = await attachments(front.media)
        const backMedia = await attachments(back.media)
        reason = 'content'
        const note = noteSchema.parse({
          id,
          deckId: 'preview',
          type: noteType,
          format: 'markdown',
          front: front.text,
          back: back.text,
          tags: [...new Set(original.tags)],
          frontMedia,
          backMedia,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
        result.notes.push({
          id,
          guid: original.guid,
          sourceId: original.id,
          model: model.name,
          input: note,
        })
        if (front.active || back.active)
          result.issues.push({
            noteId: original.id,
            model: model.name,
            reason: 'active-content',
            skipped: false,
          })
        if (front.external || back.external)
          result.issues.push({
            noteId: original.id,
            model: model.name,
            reason: 'external-media',
            skipped: false,
          })
      } catch {
        result.issues.push({
          noteId: original.id,
          model: model?.name ?? original.modelId,
          reason,
          skipped: true,
        })
      }
      progress?.(15 + ((index + 1) / Math.max(1, source.notes.length)) * 85)
    }
    const used = new Set(
      result.notes.flatMap((note) => [...note.input.frontMedia, ...note.input.backMedia]),
    )
    result.assets = [...assets.values()].filter((asset) => used.has(asset.meta.id))
    return result
  } catch (error) {
    if (error instanceof LocalizedError) throw error
    const translated = failure()
    translated.cause = error
    throw translated
  } finally {
    await reader.close()
  }
}
