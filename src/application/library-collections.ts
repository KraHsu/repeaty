import { noteLifecycle } from '../desktop/retirement'
import { msg, LocalizedError } from '../i18n'
import {
  deckSchema,
  removeNotes,
  saveNote,
  type DeckInput,
  type MediaUpload,
  type NoteInput,
  type SearchFilter,
} from '../core/model'
import { editNotes, importNotes, type BatchEdit } from '../core/batch'
import type { SourceExcerpt } from '../core/source-data'
import { saveSearch } from '../core/search'
import type { LibraryContext } from './library-context'
export function createCollectionsCommands(context: LibraryContext) {
  return {
    saveDeck(input: DeckInput, id?: string) {
      return context.commit(
        (current) => {
          const previous = current.decks.find((deck) => deck.id === id)
          if (id && !previous) throw new LocalizedError(msg('卡组已不存在。'))
          const deck = deckSchema.parse({
            ...input,
            id: id ?? crypto.randomUUID(),
            createdAt: previous?.createdAt ?? new Date().toISOString(),
          })
          return {
            ...current,
            decks: previous
              ? current.decks.map((entry) => (entry.id === id ? deck : entry))
              : [...current.decks, deck],
          }
        },
        { undoLabel: id ? '编辑卡组' : '新建卡组' },
      )
    },
    deleteDeck(id: string) {
      return context.commit(
        (current) => ({
          ...removeNotes(
            current,
            new Set(current.notes.filter((note) => note.deckId === id).map((note) => note.id)),
          ),
          decks: current.decks.filter((deck) => deck.id !== id),
          savedSearches: current.savedSearches.filter((search) => search.deckId !== id),
        }),
        { reason: '删除卡组前', undoLabel: '删除卡组' },
      )
    },
    saveNote(input: NoteInput, id?: string, assets: MediaUpload[] = [], allowRemove = false) {
      return context.commit(
        async (current) => {
          const base = {
            ...current,
            media: [...current.media, ...assets.map((entry) => entry.meta)],
          }
          if (id && 'retiredNote' in context.repository) {
            const retired = await context.repository.retiredNote(id)
            return noteLifecycle(base, input, id, retired, allowRemove).library
          }
          return saveNote(base, input, id, allowRemove)
        },
        { assets, reason: id ? '编辑笔记前' : undefined, undoLabel: id ? '编辑卡片' : '添加卡片' },
      )
    },
    async saveExcerptNote(
      input: NoteInput,
      excerpt: SourceExcerpt,
      expectedScope: string,
      assets: MediaUpload[] = [],
      allowRemove = false,
      draftId?: string,
    ) {
      if (!expectedScope || expectedScope !== context.scope.value)
        throw new LocalizedError(msg('登录账户已变更，请刷新页面后重试。'))
      if (context.busy.value) throw new LocalizedError(msg('正在保存，请稍候。'))
      if (draftId) context.draftRepository(expectedScope)
      context.busy.value = true
      try {
        const text = await context.getSource(excerpt.sourceId, undefined, excerpt.mediaId)
        if (
          text.slice(excerpt.start, excerpt.end) !== excerpt.quote ||
          expectedScope !== context.scope.value
        )
          throw new LocalizedError(msg('摘录与原文不一致，请重新选取。'))
      } finally {
        context.busy.value = false
      }
      return context.commit(
        (current) =>
          saveNote(
            { ...current, media: [...current.media, ...assets.map((asset) => asset.meta)] },
            { ...input, excerpt },
            undefined,
            allowRemove,
          ),
        { assets, reason: '摘录制卡前', consumeCardDraft: draftId, undoLabel: '用摘录制卡' },
      )
    },
    deleteNotes(ids: Set<string>) {
      return context.commit((current) => removeNotes(current, ids), {
        reason: '删除笔记前',
        undoLabel: '删除笔记',
      })
    },
    editNotes(ids: Set<string>, edit: BatchEdit) {
      return context.commit((current) => editNotes(current, ids, edit), {
        reason: '批量编辑前',
        undoLabel: '批量操作',
      })
    },
    importNotes(notes: NoteInput[], skip: boolean) {
      return context.commit((current) => importNotes(current, notes, skip), {
        reason: '导入笔记前',
        undoLabel: '批量导入',
      })
    },
    saveSearch(filter: SearchFilter, name: string, id?: string) {
      return context.commit((current) => saveSearch(current, filter, name, id))
    },
    deleteSearch(id: string) {
      return context.commit((current) => ({
        ...current,
        savedSearches: current.savedSearches.filter((entry) => entry.id !== id),
      }))
    },
    async addSample() {
      const { createStarterDeck } = await import('../core/sample')
      const { library: sample, assets } = createStarterDeck()
      return context.commit(
        (current) => ({
          ...current,
          decks: [...current.decks, ...sample.decks],
          notes: [...current.notes, ...sample.notes],
          cards: [...current.cards, ...sample.cards],
          media: [...current.media, ...sample.media],
        }),
        { assets },
      )
    },
  }
}
