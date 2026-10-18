import { msg, LocalizedError, validationMessage } from '../i18n'
import { readonly, ref, shallowRef } from 'vue'
import { ZodError } from 'zod'
import {
  deckSchema,
  emptyLibrary,
  removeNotes,
  saveNote,
  type DeckInput,
  type Grade,
  type Library,
  type MediaUpload,
  type NoteInput,
  type SearchFilter,
} from '../core/model'
import { changeCards, reviewCard, undoReview, type CardAction } from '../core/scheduler'
import { editNotes, importNotes, type BatchEdit } from '../core/batch'
import { saveSearch } from '../core/search'
import { exportBackup, rekeyBackup, type BackupData } from '../core/backups'
import { sampleLibrary } from '../core/sample'
import { createRepository, type BackupSummary } from '../core/storage'

export function useLibrary() {
  const library = shallowRef(emptyLibrary())
  const ready = ref(false),
    busy = ref(false),
    loadError = ref(''),
    backupError = ref('')
  const backups = shallowRef<BackupSummary[]>([])
  let revision = 0
  let repository: ReturnType<typeof createRepository>
  async function refreshBackups() {
    backups.value = await repository.listBackups()
  }
  async function init() {
    try {
      repository = createRepository('repeaty', () => {
        loadError.value =
          '数据库升级正在等待旧版本标签页关闭。请关闭其他 Repeaty 页面，完成后会自动继续。'
      })
      const saved = await repository.load()
      library.value = saved.library
      revision = saved.revision
      ready.value = true
      loadError.value = ''
      await refreshBackups()
    } catch {
      loadError.value =
        '无法读取本地数据库。请确认浏览器允许本站使用存储，再刷新页面。已有数据不会被自动覆盖。'
    }
  }
  async function commit(
    update: (current: Library) => Library,
    options: { assets?: MediaUpload[]; reason?: string } = {},
  ) {
    if (busy.value) throw new LocalizedError(msg('正在保存，请稍候。'))
    if (!ready.value) throw new LocalizedError(msg('本地数据库尚未准备好。'))
    busy.value = true
    try {
      const saved = await repository.save(update(library.value), revision, options)
      library.value = saved.library
      revision = saved.revision
      await refreshBackups()
    } catch (error) {
      if (error instanceof ZodError)
        throw new LocalizedError(msg('内容格式不正确：{p0}', { p0: validationMessage(error) }))
      if (error instanceof DOMException && error.name === 'QuotaExceededError')
        throw new LocalizedError(msg('浏览器存储空间不足，未保存本次修改。请先导出备份。'))
      if (
        error instanceof DOMException &&
        ['InvalidStateError', 'VersionError'].includes(error.name)
      )
        throw new LocalizedError(msg('本地数据库版本已更新，请刷新当前页面后重试。'))
      throw error
    } finally {
      busy.value = false
    }
  }
  return {
    library,
    ready: readonly(ready),
    busy: readonly(busy),
    loadError: readonly(loadError),
    backups: readonly(backups),
    backupError: readonly(backupError),
    init,
    async backupNow(force = false) {
      if (!ready.value || busy.value) return
      try {
        await repository.backupNow(force)
        await refreshBackups()
        backupError.value = ''
      } catch (error) {
        backupError.value = '自动备份未能完成，请导出 JSON 并检查存储空间。'
        if (force) throw error
      }
    },
    close() {
      return repository?.close()
    },
    getMedia(id: string) {
      return repository.getMedia(id)
    },
    exportData() {
      return exportBackup(library.value, (id) => repository.getMedia(id))
    },
    getBackup(id: string) {
      return repository.getBackup(id)
    },
    saveDeck(input: DeckInput, id?: string) {
      return commit((current) => {
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
      })
    },
    deleteDeck(id: string) {
      return commit(
        (current) => ({
          ...removeNotes(
            current,
            new Set(current.notes.filter((note) => note.deckId === id).map((note) => note.id)),
          ),
          decks: current.decks.filter((deck) => deck.id !== id),
          savedSearches: current.savedSearches.filter((search) => search.deckId !== id),
        }),
        { reason: '删除卡组前' },
      )
    },
    saveNote(input: NoteInput, id?: string, assets: MediaUpload[] = [], allowRemove = false) {
      return commit(
        (current) =>
          saveNote(
            { ...current, media: [...current.media, ...assets.map((entry) => entry.meta)] },
            input,
            id,
            allowRemove,
          ),
        { assets, reason: id ? '编辑笔记前' : undefined },
      )
    },
    deleteNotes(ids: Set<string>) {
      return commit((current) => removeNotes(current, ids), { reason: '删除笔记前' })
    },
    editNotes(ids: Set<string>, edit: BatchEdit) {
      return commit((current) => editNotes(current, ids, edit), { reason: '批量编辑前' })
    },
    importNotes(notes: NoteInput[], skip: boolean) {
      return commit((current) => importNotes(current, notes, skip), { reason: '导入笔记前' })
    },
    changeCards(ids: Set<string>, action: CardAction) {
      return commit((current) => changeCards(current, ids, action))
    },
    review(id: string, grade: Grade, filtered = false) {
      return commit((current) =>
        reviewCard(current, id, grade, new Date(), filtered ? 'filtered' : 'normal'),
      )
    },
    saveSearch(filter: SearchFilter, name: string, id?: string) {
      return commit((current) => saveSearch(current, filter, name, id))
    },
    deleteSearch(id: string) {
      return commit((current) => ({
        ...current,
        savedSearches: current.savedSearches.filter((entry) => entry.id !== id),
      }))
    },
    undo() {
      return commit(undoReview)
    },
    restore(data: BackupData) {
      const next = rekeyBackup(data)
      return commit(() => next.library, { assets: next.assets, reason: '恢复备份前' })
    },
    restoreSnapshot(data: Library) {
      return commit(() => data, { reason: '恢复快照前' })
    },
    addSample() {
      return commit((current) => {
        const sample = sampleLibrary()
        return {
          ...current,
          decks: [...current.decks, ...sample.decks],
          notes: [...current.notes, ...sample.notes],
          cards: [...current.cards, ...sample.cards],
        }
      })
    },
  }
}
