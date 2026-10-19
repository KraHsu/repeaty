import { LocalizedError, msg } from '../../i18n'
import {
  mediaSchema,
  newCard,
  noteSchema,
  pruneMedia,
  variants,
  type Library,
  type MediaUpload,
  type Note,
} from '../model'
import { ankiImportCounts, ankiNoteId, MAX_ANKI_NOTES, type AnkiPackage } from './types'

import { staleAnkiPreview, type AnkiImportPlan, type AnkiSelection } from './changes'

const invalid = () => new LocalizedError(msg('Anki 文件损坏、格式不受支持或超过导入限制。'))

/** One batch keeps shared attachments until all notes have been updated. */
function writeNotes(
  library: Library,
  data: AnkiPackage,
  notes: Note[],
  confirm: boolean,
  now: Date,
) {
  if (!notes.length) return { library, assets: [] as MediaUpload[] }
  const replacements = new Map(notes.map((note) => [note.id, note]))
  const remaining = new Map(notes.map((note) => [note.id, new Set(variants(note))]))
  const removed = new Set<string>()
  const cards = library.cards.filter((card) => {
    const keys = remaining.get(card.noteId)
    if (!keys) return true
    if (keys.delete(card.variant)) return true
    removed.add(card.id)
    return false
  })
  const existing = new Set(library.notes.map((note) => note.id))
  const addedVariants = [...remaining].some(([id, keys]) => existing.has(id) && keys.size)
  if (!confirm && (removed.size || addedVariants))
    throw new LocalizedError(msg('请先确认新增和移除的卡片。'))
  for (const [id, keys] of remaining) for (const key of keys) cards.push(newCard(id, key, now))
  const existingMedia = new Set(library.media.map((meta) => meta.id))
  const needed = new Set(
    notes
      .flatMap((note) => [...note.frontMedia, ...note.backMedia])
      .filter((id) => !existingMedia.has(id)),
  )
  const assets = data.assets.filter((asset) => needed.has(asset.meta.id))
  if (
    assets.length !== needed.size ||
    new Set(assets.map((asset) => asset.meta.id)).size !== needed.size
  )
    throw invalid()
  for (const asset of assets) {
    mediaSchema.parse(asset.meta)
    if (asset.blob.size !== asset.meta.size || asset.blob.type !== asset.meta.type) throw invalid()
  }
  const removedPractices = new Set(
    library.practices
      .filter((practice) => removed.has(practice.cardId))
      .map((practice) => practice.id),
  )
  return {
    library: pruneMedia({
      ...library,
      notes: [
        ...library.notes.map((note) => replacements.get(note.id) ?? note),
        ...notes.filter((note) => !existing.has(note.id)),
      ],
      cards,
      media: [...library.media, ...assets.map((asset) => asset.meta)],
      reviews: removed.size
        ? library.reviews.filter((review) => !removed.has(review.cardId))
        : library.reviews,
      practices: removed.size
        ? library.practices.filter((practice) => !removed.has(practice.cardId))
        : library.practices,
      attempts: removedPractices.size
        ? library.attempts.filter((attempt) => !removedPractices.has(attempt.practiceId))
        : library.attempts,
    }),
    assets,
  }
}

export function applyAnkiImportPlan(
  library: Library,
  plan: AnkiImportPlan,
  selection: AnkiSelection,
  deckId: string,
  now = new Date(),
): { library: Library; assets: MediaUpload[] } {
  if (library !== plan.base) throw staleAnkiPreview()
  if (plan.changes.length > MAX_ANKI_NOTES || new Set(selection.ids).size !== selection.ids.length)
    throw invalid()
  const changes = new Map(plan.changes.map((change) => [change.incoming.id, change]))
  const decks = new Set(library.decks.map((deck) => deck.id))
  const timestamp = now.toISOString()
  const notes = selection.ids.map((id) => {
    const change = changes.get(id)
    if (
      !change ||
      !['new', 'changed'].includes(change.status) ||
      id !== ankiNoteId(change.incoming.guid)
    )
      throw invalid()
    const target = change.current?.deckId ?? deckId
    if (!decks.has(target)) throw new LocalizedError(msg('目标卡组不存在。'))
    return noteSchema.parse({
      ...change.input,
      excerpt: change.current?.excerpt,
      id,
      deckId: target,
      createdAt: change.current?.createdAt ?? timestamp,
      updatedAt: timestamp,
    })
  })
  return writeNotes(library, plan.data, notes, selection.confirmCardChanges, now)
}

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
  const existingMedia = new Set(library.media.map((meta) => meta.id))
  if (
    imported.some((note) =>
      [...note.frontMedia, ...note.backMedia].some((id) => existingMedia.has(id)),
    )
  )
    throw invalid()
  return writeNotes(library, data, imported, false, now)
}
