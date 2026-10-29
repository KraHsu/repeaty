import { msg, LocalizedError } from '../i18n'
import { type Library } from '../core/model'
import { applyAnkiImportPlan } from '../core/anki/import'
import {
  compareAnkiImport,
  staleAnkiPreview,
  type AnkiImportPlan,
  type AnkiSelection,
} from '../core/anki/changes'
import type { AnkiPackage } from '../core/anki/types'
import type { TransferOptions } from '../core/archive'
import { exportBackup, rekeyBackup, type BackupData } from '../core/backups'
import type { LibraryContext } from './library-context'
export function createTransfersCommands(context: LibraryContext) {
  return {
    async exportArchive(
      options: TransferOptions & {
        writable?: WritableStream<Uint8Array>
      },
    ) {
      if (context.busy.value) throw new LocalizedError(msg('正在保存，请稍候。'))
      context.busy.value = true
      try {
        await context.repository.backupNow(true)
        const { exportArchive } = await import('../core/archive')
        const target = context.repository,
          expectedRevision = context.revision
        return await exportArchive(context.library.value, (id) => target.getMedia(id), {
          ...options,
          readAttempts: (offset) =>
            target.readAttemptBatch(offset, expectedRevision, options.signal),
        })
      } finally {
        context.busy.value = false
        await context.refreshBackups()
      }
    },
    async exportData() {
      if (context.busy.value) throw new LocalizedError(msg('正在保存，请稍候。'))
      context.busy.value = true
      try {
        const target = context.repository
        return await exportBackup(await target.completeLibrary(), (id) => target.getMedia(id))
      } finally {
        context.busy.value = false
      }
    },
    getBackup(id: string) {
      return context.repository.getBackup(id)
    },
    async previewAnki(data: AnkiPackage, expectedScope: string, signal?: AbortSignal) {
      const target = context.repository
      await context.savingDone
      signal?.throwIfAborted()
      if (
        !expectedScope ||
        expectedScope !== context.scope.value ||
        target !== context.repository ||
        !context.ready.value
      )
        throw staleAnkiPreview()
      const base = context.library.value,
        expectedRevision = context.revision
      function assertCurrent() {
        signal?.throwIfAborted()
        if (
          target !== context.repository ||
          expectedScope !== context.scope.value ||
          expectedRevision !== context.revision ||
          base !== context.library.value ||
          !context.ready.value
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
      if (!expectedScope || expectedScope !== context.scope.value)
        return Promise.reject(new LocalizedError(msg('登录账户已变更，请刷新页面后重试。')))
      const next = applyAnkiImportPlan(context.library.value, plan, selection, deckId)
      return context.commit(() => next.library, {
        assets: next.assets,
        reason: '导入笔记前',
        undoLabel: '批量导入',
      })
    },
    async restore(data: BackupData) {
      const next = rekeyBackup(data)
      await context.commit(() => next.library, {
        assets: next.assets,
        reason: '恢复备份前',
        undoLabel: false,
        undoBarrier: true,
      })
      context.readingUndo.value = undefined
    },
    async restoreSnapshot(data: Library) {
      await context.commit(() => data, {
        reason: '恢复快照前',
        undoLabel: false,
        undoBarrier: true,
      })
      context.readingUndo.value = undefined
    },
  }
}
