import { msg, LocalizedError, validationMessage, type DisplayMessage } from '../i18n'
import { readonly, ref, shallowRef } from 'vue'
import type { Assessment } from '../plugins/data'
import { canReviewCard } from '../plugins'
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
import { applyAnkiImportPlan } from '../core/anki/import'
import {
  compareAnkiImport,
  staleAnkiPreview,
  type AnkiImportPlan,
  type AnkiSelection,
} from '../core/anki/changes'
import type { AnkiPackage } from '../core/anki/types'
import { addSource, prepareSource, readSource, removeSource } from '../core/sources'
import type { SourceInput, SourceExcerpt } from '../core/source-data'
import { saveSearch } from '../core/search'
import type { TransferOptions } from '../core/archive'
import { exportBackup, rekeyBackup, type BackupData } from '../core/backups'
import { initializeWorkspace } from '../core/onboarding'
import { recordAttempt, finishPractice, revealPracticeHistory } from '../core/practice'
import {
  hasAttemptBody,
  sameAttemptSummary,
  type Practice,
  type Attempt,
} from '../core/practice-data'
import { remoteWorkspace } from '../edition'
import type { createServerRepository } from '../backend/repository'
import type { createRepository, BackupSummary } from '../core/storage'
import { createWorkspaceRepository } from '@repeaty-platform'
import { readLearning, LearningQueryError, type LearningQuery } from '../core/learning-reader'

export function useLibrary() {
  const library = shallowRef(emptyLibrary())
  const scope = ref('')
  const ready = ref(false),
    busy = ref(false),
    loadError = ref<DisplayMessage>(''),
    backupError = ref('')
  const backups = shallowRef<BackupSummary[]>([])
  let revision = 0
  let repository: ReturnType<typeof createRepository> | ReturnType<typeof createServerRepository>
  let savingDone: Promise<void> = Promise.resolve()
  async function refreshBackups() {
    backups.value = await repository.listBackups()
  }
  async function init() {
    if (busy.value) return
    busy.value = true
    ready.value = false
    scope.value = ''
    try {
      await repository?.close()
      repository = await createWorkspaceRepository(() => {
        loadError.value =
          '数据库升级正在等待旧版本标签页关闭。请关闭其他 Repeaty 页面，完成后会自动继续。'
      })
      const saved = await initializeWorkspace(repository)
      library.value = saved.library
      scope.value = repository.scope()
      revision = saved.revision
      ready.value = true
      loadError.value = ''
      await refreshBackups()
    } catch (error) {
      loadError.value = remoteWorkspace.value
        ? (error as Error)
        : '无法读取本地数据库。请确认浏览器允许本站使用存储，再刷新页面。已有数据不会被自动覆盖。'
    } finally {
      busy.value = false
    }
  }
  async function commit(
    update: (current: Library) => Library,
    options: { assets?: MediaUpload[]; reason?: string } = {},
  ) {
    if (busy.value) throw new LocalizedError(msg('正在保存，请稍候。'))
    if (!ready.value) throw new LocalizedError(msg('本地数据库尚未准备好。'))
    busy.value = true
    let finishSave!: () => void
    savingDone = new Promise((resolve) => {
      finishSave = resolve
    })
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
      finishSave()
    }
  }
  async function getAttempt(id: string, signal?: AbortSignal): Promise<Attempt> {
    const target = repository,
      targetScope = scope.value
    await savingDone
    signal?.throwIfAborted()
    if (target !== repository || !ready.value || targetScope !== scope.value)
      throw new LocalizedError(msg('练习记录已变化，请重新打开题目后重试。'))
    const expectedRevision = revision
    const attempt = await target.getAttempt(id, expectedRevision, signal)
    signal?.throwIfAborted()
    const current = library.value.attempts.find((entry) => entry.id === id)
    if (
      target !== repository ||
      targetScope !== scope.value ||
      revision !== expectedRevision ||
      !current ||
      !sameAttemptSummary(current, attempt)
    )
      throw new LocalizedError(msg('练习记录已变化，请重新打开题目后重试。'))
    return attempt
  }
  async function getSource(id: string, signal?: AbortSignal) {
    const target = repository,
      expectedScope = scope.value
    await savingDone
    signal?.throwIfAborted()
    const source = library.value.sources.find((entry) => entry.id === id)
    if (!source || !expectedScope || expectedScope !== scope.value || target !== repository)
      throw new LocalizedError(msg('材料已不存在，请刷新后重试。'))
    const base = library.value
    const content = await readSource(source, base, (id) => target.getMedia(id), signal)
    signal?.throwIfAborted()
    const current = library.value.sources.find((entry) => entry.id === source.id)
    if (
      target !== repository ||
      expectedScope !== scope.value ||
      current?.mediaId !== source.mediaId
    )
      throw new LocalizedError(msg('材料已不存在，请刷新后重试。'))
    return content
  }
  function localLearningSnapshot(expectedScope: string) {
    if (
      remoteWorkspace.value ||
      !ready.value ||
      busy.value ||
      !expectedScope ||
      expectedScope !== scope.value ||
      !expectedScope.startsWith('local:')
    )
      throw new LearningQueryError('library-unavailable')
    return { library: library.value, revision, scope: expectedScope }
  }
  return {
    library,
    scope: readonly(scope),
    ready: readonly(ready),
    busy: readonly(busy),
    loadError: readonly(loadError),
    backups: readonly(backups),
    backupError: readonly(backupError),
    init,
    getAttempt,
    getSource,
    localLearningSnapshot,
    readLearning(query: LearningQuery, expectedScope: string) {
      localLearningSnapshot(expectedScope)
      return readLearning(library.value, revision, query, new Date(), canReviewCard)
    },
    async backupNow(force = false) {
      if (!ready.value || busy.value) return
      try {
        await repository.backupNow(force)
        await refreshBackups()
        backupError.value = ''
      } catch (error) {
        backupError.value = '自动备份未能完成，请导出备份并检查存储空间。'
        if (force) throw error
      }
    },
    close() {
      return repository?.close()
    },
    queryCards(
      filter: SearchFilter,
      page: number,
      now: Date,
      study: boolean,
      signal?: AbortSignal,
    ) {
      return repository.queryCards(filter, page, now, study, signal)
    },
    getMedia(id: string) {
      return repository.getMedia(id)
    },
    async exportArchive(options: TransferOptions & { writable?: WritableStream<Uint8Array> }) {
      if (busy.value) throw new LocalizedError(msg('正在保存，请稍候。'))
      busy.value = true
      try {
        await repository.backupNow(true)
        const { exportArchive } = await import('../core/archive')
        const target = repository,
          expectedRevision = revision
        return await exportArchive(library.value, (id) => target.getMedia(id), {
          ...options,
          readAttempts: (offset) =>
            target.readAttemptBatch(offset, expectedRevision, options.signal),
        })
      } finally {
        busy.value = false
        await refreshBackups()
      }
    },
    async exportData() {
      if (busy.value) throw new LocalizedError(msg('正在保存，请稍候。'))
      busy.value = true
      try {
        const target = repository
        return await exportBackup(await target.completeLibrary(), (id) => target.getMedia(id))
      } finally {
        busy.value = false
      }
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
    async saveSource(input: SourceInput, expectedScope: string) {
      if (!expectedScope || expectedScope !== scope.value)
        throw new LocalizedError(msg('登录账户已变更，请刷新页面后重试。'))
      const { source, asset } = prepareSource(input)
      return commit((current) => addSource(current, source, asset), {
        assets: [asset],
        reason: '导入材料前',
      })
    },
    deleteSource(id: string, expectedScope: string) {
      if (!expectedScope || expectedScope !== scope.value)
        return Promise.reject(new LocalizedError(msg('登录账户已变更，请刷新页面后重试。')))
      return commit((current) => removeSource(current, id), { reason: '删除材料前' })
    },
    async saveExcerptNote(
      input: NoteInput,
      excerpt: SourceExcerpt,
      expectedScope: string,
      assets: MediaUpload[] = [],
      allowRemove = false,
    ) {
      if (!expectedScope || expectedScope !== scope.value)
        throw new LocalizedError(msg('登录账户已变更，请刷新页面后重试。'))
      if (busy.value) throw new LocalizedError(msg('正在保存，请稍候。'))
      busy.value = true
      try {
        const text = await getSource(excerpt.sourceId)
        if (
          text.slice(excerpt.start, excerpt.end) !== excerpt.quote ||
          expectedScope !== scope.value
        )
          throw new LocalizedError(msg('摘录与原文不一致，请重新选取。'))
      } finally {
        busy.value = false
      }
      return commit(
        (current) =>
          saveNote(
            { ...current, media: [...current.media, ...assets.map((asset) => asset.meta)] },
            { ...input, excerpt },
            undefined,
            allowRemove,
          ),
        { assets, reason: '摘录制卡前' },
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
    async previewAnki(data: AnkiPackage, expectedScope: string, signal?: AbortSignal) {
      const target = repository
      await savingDone
      signal?.throwIfAborted()
      if (!expectedScope || expectedScope !== scope.value || target !== repository || !ready.value)
        throw staleAnkiPreview()
      const base = library.value,
        expectedRevision = revision
      function assertCurrent() {
        signal?.throwIfAborted()
        if (
          target !== repository ||
          expectedScope !== scope.value ||
          expectedRevision !== revision ||
          base !== library.value ||
          !ready.value
        )
          throw staleAnkiPreview()
      }
      const plan = await compareAnkiImport(
        base,
        data,
        async (id) => {
          assertCurrent()
          const blob = await target.getMedia(id)
          assertCurrent()
          return blob
        },
        signal,
      )
      assertCurrent()
      return plan
    },
    importAnki(
      plan: AnkiImportPlan,
      selection: AnkiSelection,
      deckId: string,
      expectedScope: string,
    ) {
      if (!expectedScope || expectedScope !== scope.value)
        return Promise.reject(new LocalizedError(msg('登录账户已变更，请刷新页面后重试。')))
      const next = applyAnkiImportPlan(library.value, plan, selection, deckId)
      return commit(() => next.library, { assets: next.assets, reason: '导入笔记前' })
    },
    changeCards(ids: Set<string>, action: CardAction) {
      return commit((current) => changeCards(current, ids, action))
    },
    async recordAttempt(practice: Practice, attempt: Attempt, expectedScope: string) {
      if (expectedScope !== scope.value || !expectedScope)
        throw new LocalizedError(msg('练习记录已变化，请重新打开题目后重试。'))
      await savingDone
      if (expectedScope !== scope.value)
        throw new LocalizedError(msg('练习记录已变化，请重新打开题目后重试。'))
      const previous = library.value.attempts.find((entry) => entry.id === attempt.id)
      const expectedRevision = revision
      const full = previous && !hasAttemptBody(previous) ? await getAttempt(previous.id) : undefined
      if (expectedScope !== scope.value || (full && expectedRevision !== revision))
        throw new LocalizedError(msg('练习记录已变化，请重新打开题目后重试。'))
      return commit((current) => {
        if (full) {
          const prior = current.attempts.find((entry) => entry.id === full.id)
          if (!prior || !sameAttemptSummary(prior, full))
            throw new LocalizedError(msg('练习记录已变化，请重新打开题目后重试。'))
        }
        return recordAttempt(
          full
            ? {
                ...current,
                attempts: current.attempts.map((entry) => (entry.id === full.id ? full : entry)),
              }
            : current,
          practice,
          attempt,
        )
      })
    },
    revealPracticeHistory(practiceId: string, expectedScope: string) {
      if (expectedScope !== scope.value || !expectedScope)
        return Promise.reject(new Error('练习记录已变化，请重新打开题目后重试。'))
      if (revealPracticeHistory(library.value, practiceId) === library.value)
        return Promise.resolve()
      return commit((current) => revealPracticeHistory(current, practiceId))
    },
    finishPractice(id: string, cardId: string, assessment?: Assessment) {
      return commit((current) => finishPractice(current, id, cardId, assessment))
    },
    review(
      id: string,
      grade: Grade,
      filtered = false,
      assessment?: Assessment,
      practiceId?: string,
    ) {
      return commit((current) =>
        reviewCard(
          current,
          id,
          grade,
          new Date(),
          filtered ? 'filtered' : 'normal',
          assessment,
          canReviewCard,
          practiceId,
        ),
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
    async addSample() {
      const { createStarterDeck } = await import('../core/sample')
      const { library: sample, assets } = createStarterDeck()
      return commit(
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
