import { msg, LocalizedError, validationMessage } from '../i18n'
import { ZodError } from 'zod'
import { type Library, type SearchFilter } from '../core/model'
import { undoReview } from '../core/scheduler'
import { readSource } from '../core/sources'
import { sourceAtVersion } from '../core/source-data'
import { canUndoReading, sourceArrangement } from '../core/reading-operations'
import type { Source } from '../core/source-data'
import { initializeWorkspace } from '../core/onboarding'
import { hasAttemptBody, sameAttemptSummary, type Attempt } from '../core/practice-data'
import { readLearning, LearningQueryError, type LearningQuery } from '../core/learning-reader'
import type { CardDraft } from '../core/card-draft-data'
import { operationFor, revertOperation, replayOperation, type Operation } from '../core/operations'
import {
  operationHistory,
  rebindOperationHistory,
  MAX_OPERATION_HISTORY,
  type OperationHistory,
} from '../core/operation-history'
import type {
  LibraryState,
  LibraryDependencies,
  LibraryContext,
  LibraryRepository,
  CommitOptions,
} from './library-context'
import { createCollectionsCommands } from './library-collections'
import { createReadingCommands } from './library-reading'
import { createFilesCommands } from './library-files'
import { createStudySettingsCommands } from './library-study-settings'
import { createStudyCommands } from './library-study'
import { createTransfersCommands } from './library-transfers'
import { createSourceConnectionCommands } from './library-connections'
import { createCollectionCommands } from './library-collection'
import { createMaterialCommands } from './library-materials'
import { createOrganizationCommands } from './library-organization'
import { createWorkbenchCommands } from './library-workbench'
import { createAutomationCommands } from './library-automation'
export function createLibraryService(state: LibraryState, dependencies: LibraryDependencies) {
  const {
    library,
    scope,
    ready,
    busy,
    loadError,
    backupError,
    backups,
    readingUndo,
    operations,
    redoOperations,
  } = state
  const { createWorkspaceRepository, remoteWorkspace, desktopEdition, canReviewCard } = dependencies

  const backupListWarning = '修改已保存，但暂时无法读取快照列表。'

  let legacyUndo = true
  function syncReadingUndo() {
    readingUndo.value = undefined
    for (const entry of [...operations.value].reverse()) {
      if (entry.kind !== 'reading') continue
      const changes = entry.changes
        .filter((change) => change.store === 'sources' && change.before && change.after)
        .map((change) => ({
          id: change.id,
          mediaId: (change.after as Source).mediaId,
          before: sourceArrangement(change.before as Source),
          after: sourceArrangement(change.after as Source),
        }))
      const undo = { id: entry.id, scope: scope.value, changes }
      if (canUndoReading(library.value, undo)) {
        readingUndo.value = undo
        return
      }
    }
  }
  function adoptHistory(history?: OperationHistory) {
    const current = rebindOperationHistory(history ?? operationHistory(), scope.value)
    operations.value = current.undo
    redoOperations.value = current.redo
    legacyUndo = history === undefined
    syncReadingUndo()
  }
  let revision = 0
  let repository: LibraryRepository
  let savingDone: Promise<void> = Promise.resolve()
  let backupRead = 0
  let epoch = 0
  let initialization: Promise<void> | undefined
  const closing = new WeakMap<LibraryRepository, Promise<void>>()
  function release(target?: LibraryRepository) {
    if (!target) return Promise.resolve()
    let pending = closing.get(target)
    if (!pending) {
      pending = Promise.resolve().then(() => target.close())
      closing.set(target, pending)
    }
    return pending
  }
  async function refreshBackups() {
    const target = repository,
      request = ++backupRead
    const entries = await target.listBackups()
    if (target === repository && request === backupRead) backups.value = entries
  }
  function init(): Promise<void> {
    if (initialization) return initialization
    if (busy.value) return Promise.resolve()
    const pending = load()
    initialization = pending
    return pending.finally(() => {
      if (initialization === pending) initialization = undefined
    })
  }
  async function load() {
    const owner = ++epoch
    const owns = () => owner === epoch
    busy.value = true
    ready.value = false
    scope.value = ''
    readingUndo.value = undefined
    operations.value = []
    redoOperations.value = []
    legacyUndo = true
    try {
      await savingDone
      await release(repository)
      if (!owns()) return
      const candidate = await createWorkspaceRepository(() => {
        if (!owns()) return
        loadError.value =
          '数据库升级正在等待旧版本标签页关闭。请关闭其他 Repeaty 页面，完成后会自动继续。'
      })
      if (!owns()) {
        await release(candidate)
        return
      }
      repository = candidate
      const saved = await initializeWorkspace(candidate)
      if (!owns()) return
      library.value = saved.library
      scope.value = repository.scope()
      revision = saved.revision
      adoptHistory(saved.operationHistory)
      ready.value = true
      loadError.value = ''
      await refreshBackups()
    } catch (error) {
      if (!owns()) return
      loadError.value =
        remoteWorkspace.value || desktopEdition
          ? (error as Error)
          : '无法读取本地数据库。请确认浏览器允许本站使用存储，再刷新页面。已有数据不会被自动覆盖。'
    } finally {
      if (owns()) busy.value = false
    }
  }
  async function replaceRepository(next: typeof repository) {
    if (next === repository) return
    if (busy.value) {
      await release(next)
      throw new LocalizedError(msg('正在保存，请稍候。'))
    }
    busy.value = true
    const previous = repository
    let owner = epoch
    try {
      await savingDone
      // A failed candidate must not close or replace the user's current library.
      const saved = await next.load()
      const entries = await next.listBackups()
      if (owner !== epoch) {
        await release(next)
        throw new LocalizedError(msg('学习库内容已变化，请重新载入。'))
      }
      owner = ++epoch
      repository = next
      ++backupRead
      library.value = saved.library
      revision = saved.revision
      backups.value = entries
      loadError.value = ''
      backupError.value = ''
      ready.value = true
      scope.value = next.scope()
      adoptHistory(saved.operationHistory)
      await release(previous).catch(() => {})
    } catch (error) {
      if (repository !== next) await release(next)
      throw error
    } finally {
      if (owner === epoch) busy.value = false
    }
  }
  async function commit(
    update: (current: Library) => Library | Promise<Library>,
    options: CommitOptions = {},
  ) {
    if (busy.value) throw new LocalizedError(msg('正在保存，请稍候。'))
    if (!ready.value) throw new LocalizedError(msg('本地数据库尚未准备好。'))
    const owner = epoch,
      targetRepository = repository,
      ownerScope = scope.value,
      ownerRevision = revision
    const owns = () =>
      owner === epoch && targetRepository === repository && ownerScope === scope.value
    busy.value = true
    let finishSave!: () => void
    savingDone = new Promise((resolve) => {
      finishSave = resolve
    })
    try {
      const before = library.value,
        next = await update(before),
        entry =
          options.undoLabel === false || options.consumeCardDraft || options.undoBarrier
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
            change.before = await targetRepository.getAttempt(change.id, ownerRevision)
      }
      const history =
        options.undoBarrier || options.consumeCardDraft
          ? operationHistory()
          : (options.operationHistory ??
            (entry
              ? operationHistory([...operations.value.slice(-(MAX_OPERATION_HISTORY - 1)), entry])
              : legacyUndo
                ? undefined
                : operationHistory(operations.value, redoOperations.value)))
      if (!owns()) throw new LocalizedError(msg('学习库内容已变化，请重新载入。'))
      const saved = await targetRepository.save(next, ownerRevision, {
        ...options,
        operationHistory: history,
      })
      if (!owns()) return
      library.value = saved.library
      revision = saved.revision
      adoptHistory(history)
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
      if (owns()) busy.value = false
      finishSave()
    }
  }
  async function undoRating() {
    const reviewId = library.value.reviews.at(-1)?.id
    const entry = operations.value.find((entry) => entry.reviewId === reviewId)
    if (entry) {
      await undoRecordedOperation(entry.id)
      return
    }
    if (!legacyUndo) throw new LocalizedError(msg('没有可撤销的操作。'))
    const before = library.value
    const next = undoReview(before)
    const replay = operationFor(next, before, scope.value, '评分', 'review')!
    await commit(() => next, {
      backgroundMetadata: true,
      undoLabel: false,
      operationHistory: operationHistory(operations.value, [
        ...redoOperations.value.slice(-19),
        replay,
      ]),
    })
  }
  async function undoRecordedOperation(id: string): Promise<Operation> {
    const target = repository,
      expectedScope = scope.value
    await savingDone
    const entry = operations.value.find((entry) => entry.id === id)
    if (
      !ready.value ||
      target !== repository ||
      !expectedScope ||
      expectedScope !== scope.value ||
      !entry ||
      entry.scope !== expectedScope
    )
      throw new LocalizedError(msg('操作涉及的内容已变化，无法撤销。请刷新后检查学习库。'))
    const expectedRevision = revision
    if (entry.kind === 'review' && entry.reviewId !== library.value.reviews.at(-1)?.id)
      throw new LocalizedError(msg('操作涉及的内容已变化，无法撤销。请刷新后检查学习库。'))
    const before = library.value
    // Judge-aware rating undo preserves completed practice, while redo stores the
    // exact inverse of this result and never invokes a judge or reruns FSRS.
    const next = entry.kind === 'review' ? undoReview(before) : revertOperation(before, entry)
    const replay =
      entry.kind === 'review'
        ? {
            ...operationFor(next, before, expectedScope, entry.label, 'review')!,
            id: entry.id,
            createdAt: entry.createdAt,
          }
        : entry
    for (const change of entry.changes)
      if (
        change.store === 'media' &&
        change.before &&
        !change.after &&
        !(await target.getMedia(change.id))
      )
        throw new LocalizedError(msg('撤销所需的媒体已不存在，请从快照恢复。'))
    if (
      scope.value !== expectedScope ||
      repository !== target ||
      revision !== expectedRevision ||
      !operations.value.includes(entry)
    )
      throw new LocalizedError(msg('操作涉及的内容已变化，无法撤销。请刷新后检查学习库。'))
    await commit(() => next, {
      undoLabel: false,
      reason: '撤销操作前',
      backgroundMetadata: true,
      operationHistory: operationHistory(
        operations.value.filter((item) => item.id !== entry.id),
        [...redoOperations.value.slice(-19), replay],
      ),
    })
    return entry
  }
  async function undoLastOperation(): Promise<Operation> {
    const target = repository,
      expectedScope = scope.value
    await savingDone
    if (!ready.value || target !== repository || !expectedScope || expectedScope !== scope.value)
      throw new LocalizedError(msg('操作涉及的内容已变化，无法撤销。请刷新后检查学习库。'))
    const entry = operations.value.at(-1)
    if (entry) return undoRecordedOperation(entry.id)
    const review = library.value.reviews.at(-1)
    if (!legacyUndo || !review?.previous) throw new LocalizedError(msg('没有可撤销的操作。'))
    await undoRating()
    return redoOperations.value.at(-1)!
  }
  async function redoLastOperation(): Promise<Operation> {
    const target = repository,
      expectedScope = scope.value
    await savingDone
    const entry = redoOperations.value.at(-1)
    if (
      !ready.value ||
      target !== repository ||
      !expectedScope ||
      expectedScope !== scope.value ||
      !entry ||
      entry.scope !== expectedScope
    )
      throw new LocalizedError(msg('操作涉及的内容已变化，无法撤销。请刷新后检查学习库。'))
    const expectedRevision = revision
    const next = replayOperation(library.value, entry)
    for (const change of entry.changes)
      if (
        change.store === 'media' &&
        change.after &&
        !change.before &&
        !(await target.getMedia(change.id))
      )
        throw new LocalizedError(msg('撤销所需的媒体已不存在，请从快照恢复。'))
    if (
      scope.value !== expectedScope ||
      repository !== target ||
      revision !== expectedRevision ||
      redoOperations.value.at(-1) !== entry
    )
      throw new LocalizedError(msg('操作涉及的内容已变化，无法撤销。请刷新后检查学习库。'))
    await commit(() => next, {
      undoLabel: false,
      backgroundMetadata: true,
      operationHistory: operationHistory(
        [...operations.value.slice(-19), entry],
        redoOperations.value.slice(0, -1),
      ),
    })
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
    undoRecordedOperation,
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
      lastRedoOperation: () => redoOperations.value.at(-1),
      canRedoOperation: () => ready.value && redoOperations.value.length > 0,
      canUndoOperation: () =>
        ready.value &&
        (operations.value.length > 0 || (legacyUndo && !!library.value.reviews.at(-1)?.previous)),
      canUndoReading: () =>
        ready.value &&
        readingUndo.value?.scope === scope.value &&
        canUndoReading(library.value, readingUndo.value),
    },
    commands: {
      async applyDeviceSync(
        expectedScope: string,
        expectedRevision: number,
        next: Library,
        options: Pick<CommitOptions, 'retired' | 'sync'>,
      ) {
        if (!desktopEdition) throw new Error('sync-desktop-required')
        if (expectedScope !== scope.value || expectedRevision !== revision || !options.sync)
          throw new Error('sync-preview-stale')
        await commit(
          () => {
            if (expectedScope !== scope.value || expectedRevision !== revision)
              throw new Error('sync-preview-stale')
            return next
          },
          { ...options, undoBarrier: true, reason: '设备同步' },
        )
      },
      undoLastOperation,
      redoLastOperation,
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
        ++epoch
        ++backupRead
        initialization = undefined
        ready.value = false
        busy.value = false
        scope.value = ''
        operations.value = []
        redoOperations.value = []
        readingUndo.value = undefined
        const target = repository
        return savingDone.then(() => release(target))
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
      ...createStudySettingsCommands(context),
      ...createTransfersCommands(context),
      ...createMaterialCommands(context),
      ...createCollectionCommands(context),
      ...createSourceConnectionCommands(context),
      ...createOrganizationCommands(context),
      ...createWorkbenchCommands(context),
      ...createAutomationCommands(context),
    },
  }
}
