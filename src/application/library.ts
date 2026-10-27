import { msg, LocalizedError, validationMessage, type MessageKey } from '../i18n'
import { ZodError } from 'zod'
import { type Library, type MediaUpload, type SearchFilter } from '../core/model'
import { undoReview } from '../core/scheduler'
import { readSource } from '../core/sources'
import { sourceAtVersion } from '../core/source-data'
import { canUndoReading } from '../core/reading-operations'
import { initializeWorkspace } from '../core/onboarding'
import { hasAttemptBody, sameAttemptSummary, type Attempt } from '../core/practice-data'
import type { DocumentWrite } from '../desktop/repository'
import { readLearning, LearningQueryError, type LearningQuery } from '../core/learning-reader'
import type { CardDraft } from '../core/card-draft-data'
import { operationFor, revertOperation, type Operation } from '../core/operations'
import type {
  LibraryState,
  LibraryDependencies,
  LibraryContext,
  LibraryRepository,
} from './library-context'
import { createCollectionsCommands } from './library-collections'
import { createReadingCommands } from './library-reading'
import { createFilesCommands } from './library-files'
import { createStudyCommands } from './library-study'
import { createTransfersCommands } from './library-transfers'
export function createLibraryService(state: LibraryState, dependencies: LibraryDependencies) {
  const { library, scope, ready, busy, loadError, backupError, backups, readingUndo, operations } =
    state
  const { createWorkspaceRepository, remoteWorkspace, desktopEdition, canReviewCard } = dependencies

  const backupListWarning = '修改已保存，但暂时无法读取快照列表。'

  let legacyUndo = true
  function undoBarrier() {
    operations.value = []
    legacyUndo = false
  }
  function forgetOperation(id: string | undefined) {
    if (id)
      operations.value = operations.value.filter(
        (entry) => entry.id !== id && entry.reviewId !== id,
      )
  }
  let revision = 0
  let repository: LibraryRepository
  let savingDone: Promise<void> = Promise.resolve()
  let backupRead = 0
  async function refreshBackups() {
    const target = repository,
      request = ++backupRead
    const entries = await target.listBackups()
    if (target === repository && request === backupRead) backups.value = entries
  }
  async function init() {
    if (busy.value) return
    busy.value = true
    ready.value = false
    scope.value = ''
    readingUndo.value = undefined
    operations.value = []
    legacyUndo = true
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
      loadError.value =
        remoteWorkspace.value || desktopEdition
          ? (error as Error)
          : '无法读取本地数据库。请确认浏览器允许本站使用存储，再刷新页面。已有数据不会被自动覆盖。'
    } finally {
      busy.value = false
    }
  }
  async function replaceRepository(next: typeof repository) {
    if (next === repository) return
    if (busy.value) {
      await next.close()
      throw new LocalizedError(msg('正在保存，请稍候。'))
    }
    busy.value = true
    const previous = repository
    try {
      // A failed candidate must not close or replace the user's current library.
      const saved = await next.load()
      const entries = await next.listBackups()
      repository = next
      ++backupRead
      library.value = saved.library
      revision = saved.revision
      backups.value = entries
      readingUndo.value = undefined
      operations.value = []
      legacyUndo = true
      loadError.value = ''
      backupError.value = ''
      ready.value = true
      scope.value = next.scope()
      await previous?.close().catch(() => {})
    } catch (error) {
      if (repository !== next) await next.close()
      throw error
    } finally {
      busy.value = false
    }
  }
  async function commit(
    update: (current: Library) => Library | Promise<Library>,
    options: {
      assets?: MediaUpload[]
      reason?: string
      consumeCardDraft?: string
      externalDocuments?: DocumentWrite[]
      scanHash?: string
      assetObservations?: { path: string; hash: string }[]
      backgroundMetadata?: boolean
      undoLabel?: MessageKey | false
      undoKind?: Operation['kind']
    } = {},
  ) {
    if (busy.value) throw new LocalizedError(msg('正在保存，请稍候。'))
    if (!ready.value) throw new LocalizedError(msg('本地数据库尚未准备好。'))
    busy.value = true
    let finishSave!: () => void
    savingDone = new Promise((resolve) => {
      finishSave = resolve
    })
    try {
      const before = library.value,
        next = await update(before),
        entry =
          options.undoLabel === false || options.consumeCardDraft
            ? undefined
            : operationFor(before, next, scope.value, options.undoLabel ?? '修改', options.undoKind)
      if (entry) {
        // Compact judge history keeps code out of the active library. A deletion
        // must retain the affected bodies before the durable rows disappear.
        for (const change of entry.changes)
          if (
            change.store === 'attempts' &&
            change.before &&
            !change.after &&
            !hasAttemptBody(change.before as import('../core/practice-data').AttemptRecord)
          )
            change.before = await repository.getAttempt(change.id, revision)
      }
      const priorReading = readingUndo.value
      const removedAssets: MediaUpload[] = []
      if (entry)
        for (const change of entry.changes) {
          if (change.store === 'media' && change.before && !change.after) {
            const blob = await repository.getMedia(change.id)
            if (blob) removedAssets.push({ meta: change.before as Library['media'][number], blob })
          }
        }
      const saved = await repository.save(next, revision, options)
      library.value = saved.library
      revision = saved.revision
      if (entry)
        operations.value = [
          ...operations.value.slice(-19),
          { ...entry, previousReadingUndo: priorReading, removedAssets },
        ]
      if (options.consumeCardDraft) undoBarrier()
      // The transaction is durable. A later metadata read must not invite a second write.
      const target = repository,
        metadataScope = scope.value,
        metadataRequest = backupRead + 1
      const ownsMetadata = () =>
        target === repository && metadataScope === scope.value && metadataRequest === backupRead
      const metadata = refreshBackups()
        .then(() => {
          if (ownsMetadata() && backupError.value === backupListWarning) backupError.value = ''
        })
        .catch(() => {
          if (ownsMetadata()) backupError.value = backupListWarning
        })
      if (!options.backgroundMetadata) await metadata
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
  async function undoRating() {
    const reviewId = library.value.reviews.at(-1)?.id
    await commit(undoReview, { backgroundMetadata: true, undoLabel: false })
    forgetOperation(reviewId)
  }
  async function undoLastOperation(): Promise<Operation> {
    const target = repository,
      expectedScope = scope.value
    await savingDone
    const entry = operations.value.at(-1)
    if (!ready.value || target !== repository || !expectedScope || expectedScope !== scope.value)
      throw new LocalizedError(msg('操作涉及的内容已变化，无法撤销。请刷新后检查学习库。'))
    if (!entry) {
      const review = library.value.reviews.at(-1)
      if (!legacyUndo || !review?.previous) throw new LocalizedError(msg('没有可撤销的操作。'))
      await undoRating()
      return {
        id: review.id,
        scope: expectedScope,
        label: '评分',
        kind: 'review',
        changes: [],
        cardId: review.cardId,
        reviewId: review.id,
        noteIds: [],
      }
    }
    if (entry.scope !== expectedScope) throw new LocalizedError(msg('没有可撤销的操作。'))
    if (entry.kind === 'review') {
      if (entry.reviewId !== library.value.reviews.at(-1)?.id)
        throw new LocalizedError(msg('操作涉及的内容已变化，无法撤销。请刷新后检查学习库。'))
      await undoRating()
      return entry
    }
    const expectedRevision = revision
    const next = revertOperation(library.value, entry)
    const assets: MediaUpload[] = []
    for (const change of entry.changes)
      if (
        change.store === 'media' &&
        change.before &&
        !change.after &&
        !(await target.getMedia(change.id))
      ) {
        const retained = entry.removedAssets.find((asset) => asset.meta.id === change.id)
        if (!retained) throw new LocalizedError(msg('撤销所需的媒体已不存在，请从快照恢复。'))
        assets.push(retained)
      }
    if (
      scope.value !== expectedScope ||
      repository !== target ||
      revision !== expectedRevision ||
      operations.value.at(-1) !== entry
    )
      throw new LocalizedError(msg('操作涉及的内容已变化，无法撤销。请刷新后检查学习库。'))
    await commit(() => next, {
      assets,
      undoLabel: false,
      reason: '撤销操作前',
      backgroundMetadata: true,
    })
    forgetOperation(entry.id)
    if (entry.previousReadingUndo && canUndoReading(library.value, entry.previousReadingUndo))
      readingUndo.value = entry.previousReadingUndo
    else if (entry.kind === 'reading' || !canUndoReading(library.value, readingUndo.value))
      readingUndo.value = undefined
    return entry
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
  async function getSource(id: string, signal?: AbortSignal, mediaId?: string) {
    const target = repository,
      expectedScope = scope.value
    await savingDone
    signal?.throwIfAborted()
    const entry = library.value.sources.find((entry) => entry.id === id)
    const source = entry && sourceAtVersion(entry, mediaId)
    if (!source || !expectedScope || expectedScope !== scope.value || target !== repository)
      throw new LocalizedError(msg('材料已不存在，请刷新后重试。'))
    const base = library.value
    const content = await readSource(source, base, (id) => target.getMedia(id), signal)
    signal?.throwIfAborted()
    const current = library.value.sources.find((entry) => entry.id === source.id)
    if (
      target !== repository ||
      expectedScope !== scope.value ||
      !current ||
      !sourceAtVersion(current, source.mediaId)
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
  function draftRepository(expectedScope: string) {
    // Auxiliary draft transactions may finish while a formal save is in progress.
    if (
      remoteWorkspace.value ||
      !ready.value ||
      !expectedScope ||
      expectedScope !== scope.value ||
      !expectedScope.startsWith('local:')
    )
      throw new LearningQueryError('library-unavailable')
    if (!('readCardDrafts' in repository)) throw new LearningQueryError('library-unavailable')
    return repository
  }

  const context: LibraryContext = {
    ...state,
    commit,
    getSource,
    getAttempt,
    forgetOperation,
    undoBarrier,
    undoRating,
    refreshBackups,
    draftRepository,
    canReviewCard,
    get repository() {
      return repository
    },
    get revision() {
      return revision
    },
    get savingDone() {
      return savingDone
    },
  }
  return {
    getters: {
      lastOperation: () => operations.value.at(-1),
      canUndoOperation: () =>
        ready.value &&
        (operations.value.length > 0 || (legacyUndo && !!library.value.reviews.at(-1)?.previous)),
      canUndoReading: () =>
        ready.value &&
        readingUndo.value?.scope === scope.value &&
        canUndoReading(library.value, readingUndo.value),
    },
    commands: {
      undoLastOperation,
      readCardDrafts: (scope: string) => draftRepository(scope).readCardDrafts(),
      addCardDrafts: (scope: string, drafts: CardDraft[]) =>
        draftRepository(scope).addCardDrafts(drafts),
      updateCardDraft: (scope: string, draft: CardDraft) =>
        draftRepository(scope).updateCardDraft(draft),
      discardCardDraft: (scope: string, id: string) => draftRepository(scope).discardCardDraft(id),
      init,
      replaceRepository,
      getAttempt,
      getSource,
      localLearningSnapshot,
      readLearning(query: LearningQuery, expectedScope: string) {
        localLearningSnapshot(expectedScope)
        return readLearning(library.value, revision, query, new Date(), canReviewCard)
      },
      async backupNow(force = false) {
        if (!ready.value || busy.value) return
        const target = repository,
          expectedScope = scope.value
        const ownsScope = () => target === repository && expectedScope === scope.value
        try {
          await target.backupNow(force)
          if (!ownsScope()) return
          await refreshBackups()
          if (ownsScope()) backupError.value = ''
        } catch (error) {
          if (!ownsScope()) return
          backupError.value = '自动备份未能完成，请导出备份并检查存储空间。'
          if (force) throw error
        }
      },
      close() {
        operations.value = []
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
      ...createCollectionsCommands(context),
      ...createReadingCommands(context),
      ...createFilesCommands(context),
      ...createStudyCommands(context),
      ...createTransfersCommands(context),
    },
  }
}
