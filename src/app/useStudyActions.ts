import { t, msg } from '../i18n'
import { computed, nextTick, ref } from 'vue'
import { shortcutBlocked } from '../shortcuts'
import type { Operation } from '../core/operations'
import { useNotifications } from '../notifications'
import type { BatchEdit } from '../core/batch'
import type { AnkiImportPlan, AnkiSelection } from '../core/anki/changes'
import type { CardAction } from '../core/scheduler'
import { type NoteInput, type Grade, type SearchFilter, type StudySession } from '../core/model'
import type { useLibrary } from '../composables/useLibrary'
import type { useAppNavigation } from './useAppNavigation'
import type { useEditorActions } from './useEditorActions'
import type { useOperationRunner } from './useOperationRunner'
import type { useStudyViews } from './useStudyViews'
import type { useStudyClock } from './useStudyClock'
import type { useReadingProgress } from '../composables/useReadingProgress'
export function useStudyActions({
  library,
  busy,
  workspace,
  modal,
  reviewEditTarget,
  run,
  ready,
  activeReview,
  activeSource,
  mixedController,
  navigate,
  refreshClock,
  notice,
  mixed,
  mixedReader,
  review,
  readingProgress,
  editCard,
  sourceDraft,
  selectedDeck,
}: {
  library: ReturnType<typeof useLibrary>['library']
  busy: ReturnType<typeof useLibrary>['busy']
  workspace: ReturnType<typeof useLibrary>
  modal: ReturnType<typeof useAppNavigation>['modal']
  reviewEditTarget: ReturnType<typeof useEditorActions>['reviewEditTarget']
  run: ReturnType<typeof useOperationRunner>['run']
  ready: ReturnType<typeof useLibrary>['ready']
  activeReview: ReturnType<typeof useStudyViews>['activeReview']
  activeSource: ReturnType<typeof useStudyViews>['activeSource']
  mixedController: ReturnType<typeof useStudyViews>['mixedController']
  navigate: ReturnType<typeof useAppNavigation>['navigate']
  refreshClock: ReturnType<typeof useStudyClock>['refreshClock']
  notice: ReturnType<typeof useOperationRunner>['notice']
  mixed: ReturnType<typeof useAppNavigation>['mixed']
  mixedReader: ReturnType<typeof useStudyViews>['mixedReader']
  review: ReturnType<typeof useAppNavigation>['review']
  readingProgress: ReturnType<typeof useReadingProgress>
  editCard: ReturnType<typeof useEditorActions>['editCard']
  sourceDraft: ReturnType<typeof useEditorActions>['sourceDraft']
  selectedDeck: ReturnType<typeof useAppNavigation>['selectedDeck']
}) {
  const { dismissNotificationContext } = useNotifications()

  const mixedRatio = ref(3)
  const undoingAction = ref(false)
  const reviewBindings = computed(() => ({
    library: library.value,
    busy: busy.value,
    lastOperationId: workspace.lastOperation.value?.id,
    editing: modal.value === 'card' && !!reviewEditTarget.value,
    submit: submitReview,
    undo: undoReview,
    change: changeCards,
    getMedia: workspace.getMedia,
    workspaceScope: workspace.scope.value,
    saveAttempt: workspace.recordAttempt,
    getAttempt: workspace.getAttempt,
    getSource: workspace.getSource,
    finishPractice: (
      id: string,
      cardId: string,
      assessment?: import('../plugins/data').Assessment,
    ) => run(() => workspace.finishPractice(id, cardId, assessment)),
  }))
  const shortcutLocked = computed(
    () =>
      !ready.value ||
      busy.value ||
      undoingAction.value ||
      !!activeReview.value?.locked ||
      !!activeSource.value?.locked ||
      !!mixedController.value?.locked,
  )
  const canUndoAction = computed(
    () => workspace.canUndoOperation.value || !!activeReview.value?.canUndoPractice,
  )
  const canRedoAction = computed(() => workspace.canRedoOperation.value)
  const redoTitle = computed(
    () =>
      t('重做：{action}', { action: msg(workspace.lastRedoOperation.value?.label ?? '评分') }) +
      ' · Ctrl / ⌘ Shift Z',
  )
  const undoTitle = computed(
    () =>
      t('撤销：{action}', {
        action: msg(
          activeReview.value?.canUndoPractice
            ? '评分'
            : (workspace.lastOperation.value?.label ?? '评分'),
        ),
      }) + ' · Ctrl / ⌘ Z',
  )
  function startMixed() {
    if (!Number.isInteger(mixedRatio.value) || mixedRatio.value < 1 || mixedRatio.value > 10) return
    navigate('overview')
    refreshClock()
    notice.value = null
    modal.value = null
    mixed.value = { cardsPerReading: mixedRatio.value }
  }
  async function leaveMixedReading() {
    return (await mixedReader.value?.leaveSession()) ?? true
  }
  function startStudy(study: StudySession) {
    refreshClock()
    notice.value = null
    review.value = { study }
  }
  async function undoLastAction() {
    if (shortcutLocked.value || !canUndoAction.value) return
    undoingAction.value = true
    const release = readingProgress.hold()
    try {
      const entry = workspace.lastOperation.value
      if (activeReview.value?.canUndoPractice) {
        await activeReview.value.undoLast()
        return
      }
      if (!entry || entry.kind === 'review') {
        if (mixedController.value?.canUndoCard) {
          await mixedController.value.undoCard()
          return
        }
        if (!mixed.value && activeReview.value?.canUndo) {
          await activeReview.value.undoLast()
          return
        }
      }
      if (entry?.kind === 'reading' && workspace.canUndoReading.value) {
        if (mixedController.value) {
          await mixedController.value.undoReading()
          return
        }
        if (activeSource.value) {
          await activeSource.value.undoArrangement()
          return
        }
      }
      if (mixedController.value && !(await mixedController.value.leave())) return
      let restored: Operation | undefined
      const saved = await run(
        async () => {
          restored = await workspace.undoLastOperation()
        },
        msg('已撤销：{action}', { action: msg(entry?.label ?? '评分') }),
      )
      if (saved && restored) {
        if (restored.reviewId) dismissNotificationContext(restored.reviewId)
        await nextTick()
        if (mixedController.value) await mixedController.value.reconcileUndo(restored)
        else activeReview.value?.reconcileUndo(restored)
      }
    } finally {
      release()
      undoingAction.value = false
    }
  }
  async function redoLastAction() {
    if (shortcutLocked.value || !canRedoAction.value) return
    undoingAction.value = true
    const release = readingProgress.hold()
    try {
      if (mixedController.value && !(await mixedController.value.leave())) return
      const entry = workspace.lastRedoOperation.value
      let restored: Operation | undefined
      const saved = await run(
        async () => {
          restored = await workspace.redoLastOperation()
        },
        msg('已重做：{action}', { action: msg(entry?.label ?? '评分') }),
      )
      if (saved && restored) {
        await nextTick()
        if (mixedController.value) await mixedController.value.reconcileRedo(restored)
        else activeReview.value?.reconcileRedo(restored)
      }
    } finally {
      release()
      undoingAction.value = false
    }
  }
  function globalKeydown(event: KeyboardEvent) {
    if (shortcutBlocked(event) || shortcutLocked.value) return
    const primary = event.ctrlKey || event.metaKey
    if (
      primary &&
      !event.altKey &&
      ((event.shiftKey && event.key.toLowerCase() === 'z') ||
        (!event.shiftKey && event.key.toLowerCase() === 'y'))
    ) {
      event.preventDefault()
      void redoLastAction()
      return
    }
    if (primary && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'z') {
      event.preventDefault()
      void undoLastAction()
      return
    }
    if (primary || event.altKey) return
    const key = event.key.toLowerCase()
    if (key === 'a' && !event.shiftKey) {
      event.preventDefault()
      if (activeReview.value?.current) activeReview.value.addCurrent()
      else {
        editCard()
        if (review.value?.deckId) sourceDraft.value = { deckId: review.value.deckId }
      }
    } else if (key === '/' && !event.shiftKey) {
      event.preventDefault()
      navigate('cards')
      void nextTick(() => document.querySelector<HTMLInputElement>('.search-field input')?.focus())
    } else if (key === 'b' && !review.value && !mixed.value && !event.shiftKey) {
      event.preventDefault()
      navigate('cards')
    } else if (key === 'r' && !review.value && !mixed.value && !event.shiftKey) {
      event.preventDefault()
      startReview(selectedDeck.value || undefined)
    } else if (key === '?') {
      event.preventDefault()
      modal.value = 'shortcuts'
    }
  }
  const shortcuts = [
    ['Ctrl / ⌘ Z', '撤销最近操作'],
    ['Ctrl / ⌘ Shift Z', '重做最近操作'],
    ['Ctrl / ⌘ Enter', '保存当前表单'],
    ['A', '添加卡片 / 笔记'],
    ['E', '编辑当前卡片'],
    ['Ctrl / ⌘ Del', '删除当前笔记'],
    ['B', '浏览卡片 / 复习中暂缓'],
    ['R', '开始复习'],
    ['S', '暂停当前卡片'],
    ['Space / 1–4', '显示答案 / 评分'],
    ['/', '搜索卡片'],
    ['Esc', '退出复习 / 关闭弹窗'],
    ['?', '快捷键'],
  ] as const
  async function saveSearch(filter: SearchFilter, name: string, id?: string) {
    return run(() => workspace.saveSearch(filter, name, id), '常用筛选已保存')
  }
  async function deleteSearch(id: string) {
    return run(() => workspace.deleteSearch(id), '常用筛选已删除')
  }
  async function importNotes(notes: NoteInput[], skip: boolean) {
    if (await run(() => workspace.importNotes(notes, skip), '笔记导入完成')) modal.value = null
  }
  async function importAnki(
    plan: AnkiImportPlan,
    selection: AnkiSelection,
    deckId: string,
    scope: string,
  ) {
    return run(() => workspace.importAnki(plan, selection, deckId, scope), 'Anki 笔记导入完成')
  }
  async function changeCards(ids: string[], action: CardAction) {
    return run(() => workspace.changeCards(new Set(ids), action))
  }
  async function batchEdit(ids: string[], edit: BatchEdit) {
    return run(() => workspace.editNotes(new Set(ids), edit), '笔记已批量更新')
  }
  async function undoReview() {
    const id = library.value.reviews.at(-1)?.id
    const saved = await run(workspace.undo, '已撤销上次评分')
    if (saved && id) dismissNotificationContext(id)
    return saved
  }
  function startReview(deckId?: string) {
    refreshClock()
    notice.value = null
    review.value = { deckId }
  }
  async function submitReview(
    id: string,
    grade: Grade,
    assessment?: import('../plugins/data').Assessment,
    practiceId?: string,
  ) {
    return run(() =>
      workspace.review(id, grade, Boolean(review.value?.study?.reschedule), assessment, practiceId),
    )
  }
  return {
    mixedRatio,
    undoingAction,
    reviewBindings,
    shortcutLocked,
    canUndoAction,
    canRedoAction,
    redoTitle,
    redoLastAction,
    undoTitle,
    startMixed,
    leaveMixedReading,
    startStudy,
    undoLastAction,
    globalKeydown,
    shortcuts,
    saveSearch,
    deleteSearch,
    importNotes,
    importAnki,
    changeCards,
    batchEdit,
    undoReview,
    startReview,
    submitReview,
  }
}
