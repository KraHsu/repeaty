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
import { exportBackup, type BackupData } from '../core/backups'
import { prepareBackupRestore } from '../core/backup-restore'
import type { LibraryContext } from './library-context'
import type { RetiredNote } from '../desktop/retirement'
export function createTransfersCommands(context: LibraryContext) {
  const snapshotRetired = new WeakMap<
    Library,
    { retired: RetiredNote[]; target: LibraryContext['repository']; scope: string }
  >()
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
        const retired = 'retiredNotes' in target ? await target.retiredNotes() : []
        if (context.repository !== target || context.revision !== expectedRevision)
          throw new Error('学习库已变化，请重新导出。')
        return await exportArchive(context.library.value, (id) => target.getMedia(id), {
          ...options,
          retired,
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
        const revision = context.revision
        const library = await target.completeLibrary()
        const retired = 'retiredNotes' in target ? await target.retiredNotes() : []
        if (context.repository !== target || context.revision !== revision)
          throw new Error('学习库已变化，请重新导出。')
        return await exportBackup(library, (id) => target.getMedia(id), retired)
      } finally {
        context.busy.value = false
      }
    },
    async getBackup(id: string) {
      const target = context.repository,
        scope = context.scope.value
      const library = await target.getBackup(id)
      const retired = 'retiredNotes' in target ? await target.retiredNotes(id) : []
      if (target !== context.repository || scope !== context.scope.value)
        throw new Error('学习库已变化，请重新操作。')
      snapshotRetired.set(library, { retired, target, scope })
      return library
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
      if (data.retired?.length && !('retiredNotes' in context.repository))
        throw new Error('当前存储尚不支持恢复退役记录。')
      const target = context.repository,
        scope = context.scope.value,
        revision = context.revision
      const next = await prepareBackupRestore(data)
      const current = () => {
        if (
          target !== context.repository ||
          scope !== context.scope.value ||
          revision !== context.revision
        )
          throw new Error('学习库已变化，请重新恢复备份。')
      }
      current()
      await context.commit(
        () => {
          current()
          return next.library
        },
        {
          assets: next.assets,
          retired: next.retired ?? [],
          reason: '恢复备份前',
          undoLabel: false,
          undoBarrier: true,
        },
      )
      if (target === context.repository && scope === context.scope.value)
        context.readingUndo.value = undefined
    },
    async restoreSnapshot(data: Library) {
      const target = context.repository,
        scope = context.scope.value
      const retained = snapshotRetired.get(data)
      if (
        retained &&
        (retained.target !== context.repository || retained.scope !== context.scope.value)
      )
        throw new Error('学习库已变化，请重新操作。')
      await context.commit(() => data, {
        ...(retained ? { retired: retained.retired } : {}),
        reason: '恢复快照前',
        undoLabel: false,
        undoBarrier: true,
      })
      if (target === context.repository && scope === context.scope.value)
        context.readingUndo.value = undefined
    },
  }
}
