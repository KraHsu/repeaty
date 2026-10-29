import { msg, LocalizedError } from '../i18n'
import {
  addSource,
  editSourceDetails,
  prepareSource,
  removeSource,
  saveReadingPosition,
  prepareSourceExcerpt,
} from '../core/sources'
import type {
  SourceInput,
  ReadingUpdate,
  SourceQueueUpdate,
  SaveSourceExcerptInput,
  SourceDetailsUpdate,
  SourceBatchUpdate,
} from '../core/source-data'
import { arrangeSource } from '../core/source-queue'
import {
  arrangeSources,
  readingUndoFor,
  canUndoReading,
  undoReading,
} from '../core/reading-operations'
import type { LibraryContext } from './library-context'
export function createReadingCommands(context: LibraryContext) {
  return {
    async saveSourceReading(update: ReadingUpdate, at: Date) {
      const target = context.repository
      await context.savingDone
      if (
        !context.ready.value ||
        !update.scope ||
        update.scope !== context.scope.value ||
        target !== context.repository
      )
        throw new LocalizedError(msg('学习库已变化，阅读位置未保存。'))
      const next = saveReadingPosition(
        context.library.value,
        update.sourceId,
        update.mediaId,
        update.position,
        at,
      )
      if (next !== context.library.value) await context.commit(() => next, { undoLabel: false })
    },
    async arrangeSource(update: SourceQueueUpdate) {
      const target = context.repository
      await context.savingDone
      if (
        !context.ready.value ||
        !update.scope ||
        update.scope !== context.scope.value ||
        target !== context.repository
      )
        throw new LocalizedError(msg('学习库已变化，阅读安排未保存。'))
      const at = new Date(),
        before = context.library.value
      let next = arrangeSource(
        context.library.value,
        update.sourceId,
        update.mediaId,
        update.action,
        at,
      )
      if (update.position)
        next = saveReadingPosition(next, update.sourceId, update.mediaId, update.position, at)
      if (next !== context.library.value) {
        await context.commit(() => next, {
          reason: '更改阅读安排前',
          undoLabel: '阅读安排',
          undoKind: 'reading',
        })
        const undo = readingUndoFor(before, context.library.value, update.scope)
        if (undo && context.scope.value === update.scope)
          context.readingUndo.value = {
            ...undo,
            id: context.operations.value.at(-1)?.id ?? undo.id,
          }
      }
    },
    async arrangeSources(update: SourceBatchUpdate) {
      const target = context.repository
      await context.savingDone
      if (
        !context.ready.value ||
        !update.scope ||
        update.scope !== context.scope.value ||
        target !== context.repository
      )
        throw new LocalizedError(msg('学习库已变化，阅读安排未保存。'))
      const before = context.library.value,
        at = new Date()
      let next = arrangeSources(before, update.targets, update.action, at)
      if (update.reading) {
        if (
          update.reading.scope !== update.scope ||
          !update.targets.some(
            (t) => t.id === update.reading!.sourceId && t.mediaId === update.reading!.mediaId,
          )
        )
          throw new LocalizedError(msg('材料或阅读安排已变化，请重新选择。'))
        next = saveReadingPosition(
          next,
          update.reading.sourceId,
          update.reading.mediaId,
          update.reading.position,
          at,
        )
      }
      if (next !== context.library.value) {
        await context.commit(() => next, {
          reason: '更改阅读安排前',
          undoLabel: '阅读安排',
          undoKind: 'reading',
        })
        const undo = readingUndoFor(before, context.library.value, update.scope)
        if (undo && context.scope.value === update.scope)
          context.readingUndo.value = {
            ...undo,
            id: context.operations.value.at(-1)?.id ?? undo.id,
          }
      }
    },
    async undoReadingArrangement(expectedScope: string) {
      const target = context.repository,
        undo = context.readingUndo.value
      await context.savingDone
      if (
        !context.ready.value ||
        !expectedScope ||
        expectedScope !== context.scope.value ||
        target !== context.repository ||
        !undo ||
        undo.scope !== expectedScope ||
        undo !== context.readingUndo.value
      )
        throw new LocalizedError(msg('材料或阅读安排已变化，请重新选择。'))
      const previous = context.operations.value.find(
        (entry) => entry.id === undo.id,
      )?.previousReadingUndo
      const next = undoReading(context.library.value, undo)
      await context.commit(() => next, { reason: '撤销阅读安排前', undoLabel: false })
      context.forgetOperation(undo.id)
      if (context.readingUndo.value === undo)
        context.readingUndo.value =
          previous && canUndoReading(context.library.value, previous) ? previous : undefined
    },
    async editSourceDetails(update: SourceDetailsUpdate) {
      const target = context.repository
      await context.savingDone
      if (
        !context.ready.value ||
        !update.scope ||
        update.scope !== context.scope.value ||
        target !== context.repository
      )
        throw new LocalizedError(msg('学习库已变化，材料信息未保存。'))
      let next = editSourceDetails(
        context.library.value,
        update.sourceId,
        update.mediaId,
        update.before,
        update.details,
      )
      if (update.position)
        next = saveReadingPosition(
          next,
          update.sourceId,
          update.mediaId,
          update.position,
          new Date(),
        )
      if (next !== context.library.value)
        await context.commit(() => next, { reason: '编辑材料信息前', undoLabel: '编辑材料信息' })
    },
    async saveSource(input: SourceInput, expectedScope: string) {
      if (!expectedScope || expectedScope !== context.scope.value)
        throw new LocalizedError(msg('登录账户已变更，请刷新页面后重试。'))
      const { source, asset } = prepareSource(input)
      return context.commit((current) => addSource(current, source, asset), {
        assets: [asset],
        reason: '导入材料前',
        undoLabel: '导入材料',
      })
    },
    async saveSourceExcerpt(input: SaveSourceExcerptInput) {
      const target = context.repository
      await context.savingDone
      if (
        !context.ready.value ||
        !input.scope ||
        input.scope !== context.scope.value ||
        target !== context.repository
      )
        throw new LocalizedError(msg('学习库已变化，摘录未保存。'))
      if (context.busy.value) throw new LocalizedError(msg('正在保存，请稍候。'))
      context.busy.value = true
      let prepared: ReturnType<typeof prepareSourceExcerpt>
      const at = new Date()
      try {
        const text = await context.getSource(input.excerpt.sourceId)
        const parent = context.library.value.sources.find(
          (source) => source.id === input.excerpt.sourceId,
        )
        if (
          !parent ||
          parent.mediaId !== input.mediaId ||
          input.scope !== context.scope.value ||
          target !== context.repository
        )
          throw new LocalizedError(msg('材料已变化，请重新打开后继续阅读。'))
        prepared = prepareSourceExcerpt(parent, text, input.excerpt, input.title, at)
      } finally {
        context.busy.value = false
      }
      return context.commit(
        (current) => {
          let next = addSource(current, prepared.source, prepared.asset)
          if (input.position)
            next = saveReadingPosition(
              next,
              input.excerpt.sourceId,
              input.mediaId,
              input.position,
              at,
            )
          return next
        },
        { assets: [prepared.asset], reason: '保存摘录前', undoLabel: '保存摘录' },
      )
    },
    deleteSource(id: string, expectedScope: string) {
      if (!expectedScope || expectedScope !== context.scope.value)
        return Promise.reject(new LocalizedError(msg('登录账户已变更，请刷新页面后重试。')))
      return context.commit((current) => removeSource(current, id), {
        reason: '删除材料前',
        undoLabel: '删除材料',
      })
    },
  }
}
