import { onScopeDispose, ref, shallowReactive, watch } from 'vue'
import type { useLibrary } from './useLibrary'
import type { ReadingUpdate } from '../core/source-data'
import { sameReadingPosition } from '../core/sources'
import type { DisplayMessage } from '../i18n'

type Pending = { update: ReadingUpdate; at: Date; token: number; error?: DisplayMessage }
export function useReadingProgress(workspace: ReturnType<typeof useLibrary>) {
  const pending = shallowReactive(new Map<string, Pending>())
  const savingId = ref('')
  let timer: ReturnType<typeof setTimeout> | undefined
  let token = 0,
    epoch = 0,
    disposed = false
  function record(update: ReadingUpdate, immediately = false) {
    if (!workspace.ready.value || update.scope !== workspace.scope.value) return
    const source = workspace.library.value.sources.find(
      (source) => source.id === update.sourceId && source.mediaId === update.mediaId,
    )
    if (
      !source ||
      (!immediately &&
        sameReadingPosition(
          pending.get(source.id)?.update.position ?? source.reading,
          update.position,
        ))
    )
      return
    const { offset, fraction, view } = update.position
    pending.set(source.id, {
      update: {
        sourceId: update.sourceId,
        mediaId: update.mediaId,
        scope: update.scope,
        position: { offset, fraction, view },
      },
      at: new Date(),
      token: ++token,
    })
    clearTimeout(timer)
    timer = undefined
    if (immediately) void flush()
    else
      timer = setTimeout(() => {
        timer = undefined
        void flush()
      }, 700)
  }
  async function flush() {
    if (savingId.value || workspace.busy.value || !workspace.ready.value || disposed) return
    clearTimeout(timer)
    timer = undefined
    const generation = epoch
    while (pending.size && generation === epoch && !workspace.busy.value && !disposed) {
      const entry = pending.values().next().value!
      savingId.value = entry.update.sourceId
      try {
        await workspace.saveSourceReading(entry.update, entry.at)
        if (generation === epoch && pending.get(entry.update.sourceId)?.token === entry.token)
          pending.delete(entry.update.sourceId)
      } catch (error) {
        if (generation === epoch && pending.get(entry.update.sourceId)?.token === entry.token) {
          pending.set(entry.update.sourceId, { ...entry, error: error as Error })
          break
        }
      } finally {
        if (generation === epoch) savingId.value = ''
      }
    }
  }
  watch(
    () => workspace.busy.value,
    (busy) => {
      if (!busy && !timer && ![...pending.values()].some((entry) => entry.error))
        timer = setTimeout(() => {
          // Let the completed operation clear stale work after a restore.
          timer = undefined
          void flush()
        }, 0)
    },
  )
  function clear() {
    epoch++
    clearTimeout(timer)
    timer = undefined
    pending.clear()
    savingId.value = ''
  }
  watch(() => workspace.scope.value, clear, { flush: 'sync' })
  watch(
    () => workspace.library.value.sources,
    (sources) => {
      for (const [id, entry] of pending)
        if (!sources.some((source) => source.id === id && source.mediaId === entry.update.mediaId))
          pending.delete(id)
    },
    { flush: 'sync' },
  )
  onScopeDispose(() => {
    disposed = true
    epoch++
    clearTimeout(timer)
    pending.clear()
  })
  return { record, flush, clear, pending, savingId }
}
export type ReadingProgress = ReturnType<typeof useReadingProgress>
