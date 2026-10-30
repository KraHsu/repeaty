import { msg, LocalizedError } from '../i18n'
import { z } from 'zod'
import type { RetiredNote } from '../desktop/retirement'
import {
  backupMedia,
  retiredBackupSchema,
  validateRetiredBackup,
  rekeyPortableNote,
  rekeyPortablePlugin,
} from './retired-backup'
import {
  MAX_BACKUP_BYTES,
  librarySchema,
  migrateLibrary,
  type Library,
  type MediaUpload,
} from './model'

export interface BackupData {
  library: Library
  assets: MediaUpload[]
  retired?: RetiredNote[]
}
const packageSchema = z.object({
  format: z.literal('repeaty-backup'),
  version: z.union([
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
    z.literal(13),
    z.literal(14),
    z.literal(15),
    z.literal(16),
  ]),
  library: z.unknown().transform((value) => migrateLibrary(value)),
  retired: retiredBackupSchema.optional(),
  assets: z.array(
    z.object({
      id: z.string(),
      data: z
        .string()
        .refine((value) => value.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(value)),
    }),
  ),
})
export async function exportBackup(
  library: Library,
  getMedia: (id: string) => Promise<Blob | undefined>,
  retired: RetiredNote[] = [],
): Promise<string> {
  librarySchema.parse(library)
  validateRetiredBackup(library, retired)
  const metadata = backupMedia(library, retired)
  if (
    metadata.reduce((sum, item) => sum + (item.size * 4) / 3, 0) +
      (JSON.stringify(library).length + JSON.stringify(retired).length) * 3 >
    MAX_BACKUP_BYTES
  )
    throw new LocalizedError(msg('JSON 备份超过 100 MB，请改用 .repeaty 格式导出。'))
  const assets = []
  for (const meta of metadata) {
    const blob = await getMedia(meta.id)
    if (!blob || blob.size !== meta.size || blob.type !== meta.type)
      throw new LocalizedError(msg('无法导出：附件「{p0}」缺失或损坏。', { p0: meta.name }))
    const bytes = new Uint8Array(await blob.arrayBuffer())
    let binary = ''
    for (let i = 0; i < bytes.length; i += 0x8000)
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    assets.push({ id: meta.id, data: btoa(binary) })
  }
  const result = JSON.stringify({
    format: 'repeaty-backup',
    version: 16,
    library,
    assets,
    ...(retired.length ? { retired } : {}),
  })
  if (new Blob([result]).size > MAX_BACKUP_BYTES)
    throw new LocalizedError(msg('JSON 备份超过 100 MB。'))
  return result
}
export function parseBackup(text: string): BackupData {
  if (new Blob([text]).size > MAX_BACKUP_BYTES)
    throw new LocalizedError(msg('备份文件不能超过 100 MB。'))
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new LocalizedError(msg('文件不是有效的 JSON。'))
  }
  try {
    if (typeof raw === 'object' && raw !== null && 'format' in raw) {
      const data = packageSchema.parse(raw)
      validateRetiredBackup(data.library, data.retired ?? [])
      const metadata = backupMedia(data.library, data.retired ?? [])
      const encoded = new Map(data.assets.map((entry) => [entry.id, entry.data]))
      if (encoded.size !== data.assets.length || encoded.size !== metadata.length)
        throw new LocalizedError(msg('媒体数量不匹配'))
      const assets = metadata.map((meta) => {
        const base64 = encoded.get(meta.id)
        if (base64 === undefined) throw new LocalizedError(msg('媒体缺失'))
        const bytes = Uint8Array.from(atob(base64), (ch) => ch.charCodeAt(0))
        if (bytes.length !== meta.size) throw new LocalizedError(msg('媒体大小不匹配'))
        return { meta, blob: new Blob([bytes], { type: meta.type }) }
      })
      return {
        library: data.library,
        assets,
        ...(data.retired?.length ? { retired: data.retired } : {}),
      }
    }
    const library = migrateLibrary(raw)
    if (library.media.length) throw new LocalizedError(msg('完整备份缺少媒体'))
    return { library, assets: [] }
  } catch {
    throw new LocalizedError(
      msg('备份格式不正确、媒体不完整或版本不兼容，请使用 Repeaty 导出的 JSON 文件。'),
    )
  }
}
// Imported assets receive fresh identities so existing automatic snapshots stay immutable.
export function rekeyBackup(data: BackupData): BackupData {
  const ids = new Map(
    backupMedia(data.library, data.retired ?? []).map((meta) => [meta.id, crypto.randomUUID()]),
  )
  return {
    ...(data.retired
      ? {
          retired: data.retired.map((entry) => ({
            ...entry,
            note: entry.note ? rekeyPortableNote(entry.note, ids) : null,
            media: entry.media.map((meta) => ({ ...meta, id: ids.get(meta.id)! })),
            practices: entry.practices.map((practice) => ({
              ...practice,
              question: {
                ...practice.question,
                plugin: rekeyPortablePlugin(practice.question.plugin, ids),
              },
            })),
          })),
        }
      : {}),
    library: {
      ...data.library,
      // A restore/import assigns a new operation scope; old retry keys must not affect it.
      materialReceipts: [],
      sources: data.library.sources.map((source) => ({
        ...source,
        mediaId: ids.get(source.mediaId)!,
        annotations: source.annotations?.map((annotation) => ({
          ...annotation,
          mediaId: ids.get(annotation.mediaId)!,
          ...(annotation.locator
            ? {
                locator: {
                  ...annotation.locator,
                  versionId: ids.get(annotation.locator.versionId)!,
                },
              }
            : {}),
        })),
        reading: source.reading
          ? {
              ...source.reading,
              ...(source.reading.locator
                ? {
                    locator: {
                      ...source.reading.locator,
                      versionId: ids.get(source.reading.locator.versionId)!,
                    },
                  }
                : {}),
            }
          : undefined,
        document: source.document
          ? {
              ...source.document,
              originalMediaId: ids.get(source.document.originalMediaId)!,
              resources: source.document.resources?.map((ref) => ({
                ...ref,
                mediaId: ids.get(ref.mediaId)!,
              })),
            }
          : undefined,
        inlineMedia: source.inlineMedia?.map((ref) => ({ ...ref, mediaId: ids.get(ref.mediaId)! })),
        versions: source.versions?.map((version) => ({
          ...version,
          mediaId: ids.get(version.mediaId)!,
          reading: version.reading
            ? {
                ...version.reading,
                ...(version.reading.locator
                  ? {
                      locator: {
                        ...version.reading.locator,
                        versionId: ids.get(version.reading.locator.versionId)!,
                      },
                    }
                  : {}),
              }
            : undefined,
          document: version.document
            ? {
                ...version.document,
                originalMediaId: ids.get(version.document.originalMediaId)!,
                resources: version.document.resources?.map((ref) => ({
                  ...ref,
                  mediaId: ids.get(ref.mediaId)!,
                })),
              }
            : undefined,
          inlineMedia: version.inlineMedia?.map((ref) => ({
            ...ref,
            mediaId: ids.get(ref.mediaId)!,
          })),
        })),
        origin: source.origin
          ? {
              ...source.origin,
              ...(source.origin.mediaId ? { mediaId: ids.get(source.origin.mediaId)! } : {}),
              ...(source.origin.locator
                ? {
                    locator: {
                      ...source.origin.locator,
                      versionId: ids.get(source.origin.locator.versionId)!,
                    },
                  }
                : {}),
            }
          : undefined,
      })),
      media: data.library.media.map((meta) => ({ ...meta, id: ids.get(meta.id)! })),
      notes: data.library.notes.map((note) => rekeyPortableNote(note, ids)),
      practices: data.library.practices.map((practice) => ({
        ...practice,
        question: {
          ...practice.question,
          plugin: rekeyPortablePlugin(practice.question.plugin, ids),
        },
      })),
    },
    assets: data.assets.map((entry) => ({
      ...entry,
      meta: { ...entry.meta, id: ids.get(entry.meta.id)! },
    })),
  }
}
