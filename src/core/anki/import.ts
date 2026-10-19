import { LocalizedError, msg } from '../../i18n'
import { newCard, noteSchema, variants, type Library, type MediaUpload } from '../model'
import { ankiImportCounts, ankiNoteId, MAX_ANKI_NOTES, type AnkiPackage } from './types'

export function prepareAnkiImport(
  library: Library,
  data: AnkiPackage,
  deckId: string,
  now = new Date(),
): { library: Library; assets: MediaUpload[] } {
  if (!library.decks.some((deck) => deck.id === deckId))
    throw new LocalizedError(msg('目标卡组不存在。'))
  if (data.notes.length > MAX_ANKI_NOTES)
    throw new LocalizedError(msg('每次最多导入 5000 条笔记。'))
  const { notes } = ankiImportCounts(library, data)
  const timestamp = now.toISOString(),
    ids = new Set<string>()
  const imported = notes.map((note) => {
    if (note.id !== ankiNoteId(note.guid) || ids.has(note.id))
      throw new LocalizedError(msg('Anki 文件损坏、格式不受支持或超过导入限制。'))
    ids.add(note.id)
    return noteSchema.parse({
      ...note.input,
      id: note.id,
      deckId,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
  })
  const used = new Set(imported.flatMap((note) => [...note.frontMedia, ...note.backMedia]))
  const assets = data.assets.filter((asset) => used.has(asset.meta.id))
  const existingMedia = new Set(library.media.map((meta) => meta.id))
  if (
    assets.length !== used.size ||
    new Set(assets.map((asset) => asset.meta.id)).size !== used.size ||
    assets.some((asset) => existingMedia.has(asset.meta.id))
  )
    throw new LocalizedError(msg('Anki 文件损坏、格式不受支持或超过导入限制。'))
  const cards = imported.flatMap((note) =>
    variants(note).map((variant) => newCard(note.id, variant, now)),
  )
  return {
    library: {
      ...library,
      notes: [...library.notes, ...imported],
      cards: [...library.cards, ...cards],
      media: [...library.media, ...assets.map((asset) => asset.meta)],
    },
    assets,
  }
}
