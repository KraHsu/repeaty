import { ref } from 'vue'
import { createExportFile } from '@repeaty-platform'
import type { BackupData } from '../core/backups'
import { type Library } from '../core/model'
import type { useLibrary } from '../composables/useLibrary'
import type { useStudyClock } from './useStudyClock'
import type { useOperationRunner } from './useOperationRunner'
import type { useAppNavigation } from './useAppNavigation'
import type { useReadingProgress } from '../composables/useReadingProgress'
export function useBackupActions({
  busy,
  now,
  workspace,
  notice,
  run,
  modal,
  readingProgress,
  selectedDeck,
}: {
  busy: ReturnType<typeof useLibrary>['busy']
  now: ReturnType<typeof useStudyClock>['now']
  workspace: ReturnType<typeof useLibrary>
  notice: ReturnType<typeof useOperationRunner>['notice']
  run: ReturnType<typeof useOperationRunner>['run']
  modal: ReturnType<typeof useAppNavigation>['modal']
  readingProgress: ReturnType<typeof useReadingProgress>
  selectedDeck: ReturnType<typeof useAppNavigation>['selectedDeck']
}) {
  const pendingBackup = ref<BackupData>()
  const pendingSnapshot = ref<Library>()
  const upload = ref<HTMLInputElement>()
  const transfer = ref<{ label: string; percent: number }>()
  let transferController: AbortController | undefined
  let transferGeneration = 0
  const filePicker = (
    window as Window & { showSaveFilePicker?: (options: unknown) => Promise<FileSystemFileHandle> }
  ).showSaveFilePicker?.bind(window)
  function cancelTransfer() {
    transferController?.abort(new DOMException('Canceled', 'AbortError'))
  }
  async function exportData(format: 'archive' | 'json' | 'file' = 'archive') {
    if (transfer.value || busy.value) return
    const filename = `repeaty-backup-${now.value.toISOString().slice(0, 10)}.${format === 'json' ? 'json' : 'repeaty'}`
    let writable: WritableStream<Uint8Array> | undefined
    // Claim the export before the first await. The native save dialog can take a while, and a
    // second click during it must not start a parallel export that shares this state.
    const owner = new AbortController()
    const generation = (transferGeneration += 1)
    transferController = owner
    transfer.value = { label: '正在准备备份…', percent: 0 }
    try {
      if (createExportFile) writable = await createExportFile(filename)
      else if (format === 'file' && filePicker) {
        const handle = await filePicker({
          suggestedName: filename,
          types: [{ description: 'Repeaty backup', accept: { 'application/zip': ['.repeaty'] } }],
        })
        writable = await handle.createWritable()
      }
      if (generation === transferGeneration) transfer.value = { label: '正在导出备份…', percent: 0 }
      const blob =
        format === 'json'
          ? new Blob([await workspace.exportData()], { type: 'application/json' })
          : await workspace.exportArchive({
              writable,
              signal: owner.signal,
              progress: (percent) => {
                if (generation === transferGeneration && transfer.value)
                  transfer.value.percent = percent
              },
            })
      if (blob && writable) await blob.stream().pipeTo(writable)
      else if (blob) {
        const url = URL.createObjectURL(blob),
          link = document.createElement('a')
        link.href = url
        link.download = filename
        link.click()
        setTimeout(() => URL.revokeObjectURL(url), 60_000)
      }
      notice.value = { text: '包含媒体的完整备份已生成', error: false }
    } catch (error) {
      await writable?.abort().catch(() => {})
      notice.value =
        error instanceof DOMException && error.name === 'AbortError'
          ? { text: '已取消备份操作', error: false }
          : { text: error as Error, error: true }
    } finally {
      // Only the export that still owns the state may clear it; an earlier superseded run
      // must not remove the progress of the one actually writing.
      if (generation === transferGeneration) {
        transfer.value = undefined
        transferController = undefined
      }
    }
  }
  async function openSnapshot(id: string) {
    await run(async () => {
      pendingSnapshot.value = await workspace.getBackup(id)
      modal.value = 'snapshot'
    })
  }
  async function restoreSnapshot() {
    const data = pendingSnapshot.value
    if (data && (await run(() => workspace.restoreSnapshot(data), '快照已恢复'))) {
      readingProgress.clear()
      modal.value = null
      selectedDeck.value = ''
      pendingSnapshot.value = undefined
    }
  }
  async function importData(event: Event) {
    const input = event.target as HTMLInputElement
    const file = input.files?.[0]
    if (!file) return
    notice.value = null
    try {
      transferController = new AbortController()
      transfer.value = { label: '正在检查备份…', percent: 0 }
      const { parseBackupFile } = await import('../core/archive')
      pendingBackup.value = await parseBackupFile(file, {
        signal: transferController.signal,
        progress: (percent) => {
          if (transfer.value) transfer.value.percent = percent
        },
      })
      modal.value = 'import'
    } catch (error) {
      notice.value =
        error instanceof DOMException && error.name === 'AbortError'
          ? { text: '已取消备份操作', error: false }
          : { text: error as Error, error: true }
    } finally {
      transfer.value = undefined
      transferController = undefined
      input.value = ''
    }
  }
  async function restoreBackup() {
    const data = pendingBackup.value
    if (data && (await run(() => workspace.restore(data), '备份已恢复'))) {
      readingProgress.clear()
      modal.value = null
      pendingBackup.value = undefined
      selectedDeck.value = ''
    }
  }
  return {
    pendingBackup,
    pendingSnapshot,
    upload,
    transfer,
    filePicker,
    cancelTransfer,
    exportData,
    openSnapshot,
    restoreSnapshot,
    importData,
    restoreBackup,
  }
}
