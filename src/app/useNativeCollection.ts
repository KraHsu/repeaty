import { onScopeDispose, ref, shallowRef, watch } from 'vue'
import type { ComputedRef } from 'vue'
import type { CollectionHostApi } from '@repeaty/plugin-api'
import type { useLibrary } from '../composables/useLibrary'
import type { CapturePayload } from '../desktop/collection'
import { inspectCollectionPath } from '../core/collection-input'
import type { CollectionInput } from '../core/collection-input'
import * as platform from '@repeaty-collection-platform'
import { useNotifications } from '../notifications'
import { LocalizedError, msg, type DisplayMessage } from '../i18n'
import { captureMessage } from '../core/capture-errors'

export function captureInput(payload: CapturePayload): CollectionInput {
  const files = payload.files.map((entry, index) => {
    const name = (entry.name || `capture-${index}`).replace(/[\\/:\u0000-\u001f]/g, '_')
    const path = entry.path || name
    if ('reason' in inspectCollectionPath(path)) throw new Error('剪贴板中的文件路径不受支持。')
    const file = new File([Uint8Array.from(entry.bytes)], name, { type: entry.type })
    Object.defineProperty(file, 'webkitRelativePath', { value: path })
    return { file, path }
  })
  if (!payload.text?.trim() && payload.html?.trim()) {
    const file = new File([payload.html], 'clipboard.html', { type: 'text/html' })
    files.push({ file, path: file.name })
  }
  return {
    files,
    issues: [],
    bytes: files.reduce((n, f) => n + f.file.size, 0),
    text: payload.text || undefined,
  }
}
export function useNativeCollection(
  workspace: ReturnType<typeof useLibrary>,
  collection: ComputedRef<CollectionHostApi | undefined>,
) {
  const { notify } = useNotifications(),
    pending = shallowRef<{ scope: string; payload: CapturePayload }>(),
    error = shallowRef<DisplayMessage>(''),
    saving = ref(false)
  let alive = true,
    epoch = 0,
    stop: (() => void) | undefined,
    ready: Promise<void> = Promise.resolve()
  async function savePending() {
    const captured = pending.value,
      api = collection.value
    if (
      !alive ||
      !workspace.ready.value ||
      saving.value ||
      !captured ||
      !api ||
      captured.scope !== workspace.scope.value
    )
      return
    const current = epoch
    saving.value = true
    error.value = ''
    let planId: string | undefined
    try {
      const input = captureInput(captured.payload)
      const plan = await api.prepareCollection({
        files: input.files.map((e) => e.file),
        text: input.text ? { text: input.text, format: 'plain' } : undefined,
        destination: 'inbox',
        kind: 'global',
      })
      planId = plan.id
      if (!alive || current !== epoch || captured.scope !== workspace.scope.value)
        throw new Error('学习库已变化。')
      await api.commitCollection({
        planId: plan.id,
        expectedRevision: plan.revision,
        operationId: crypto.randomUUID(),
      })
      if (alive && current === epoch) {
        pending.value = undefined
        notify('已收集到收件箱。', 'info', 'collection')
      }
    } catch (reason) {
      if (alive && current === epoch) {
        const detail = captureMessage(reason)
        error.value = detail
        notify(
          msg('收集未保存：{error} 可在设置中重试。', { error: detail }),
          'error',
          'collection',
        )
      }
    } finally {
      if (planId) api.discardCollection(planId)
      if (current === epoch) saving.value = false
    }
  }
  if (platform.nativeCollection) {
    watch(
      [workspace.scope, workspace.ready],
      ([scope, isReady]) => {
        const current = ++epoch
        pending.value = undefined
        error.value = ''
        saving.value = false
        // Native validates its real active library/session, independently of the caller's string.
        ready = platform.bindCollectionScope(isReady ? scope : '')
        void ready.catch((reason) => {
          if (alive && current === epoch) error.value = captureMessage(reason)
        })
      },
      { immediate: true, flush: 'sync' },
    )
    void platform
      .onCapture((event) => {
        if (!alive || !workspace.ready.value || event.scope !== workspace.scope.value) return
        if (event.error) {
          const detail = captureMessage(event.error)
          error.value = detail
          notify(msg('无法收集：{error}', { error: detail }), 'error', 'collection')
          return
        }
        if (pending.value || saving.value) {
          notify('上一条收集尚未保存，请先在设置中处理。', 'warning', 'collection')
          return
        }
        const current = epoch
        void (async () => {
          await ready
          if (!alive || current !== epoch || workspace.scope.value !== event.scope) return
          const payload = await platform.takeCapture(event.scope, event.id)
          if (!alive || current !== epoch || workspace.scope.value !== event.scope) return
          pending.value = { scope: event.scope, payload }
          await savePending()
        })().catch((reason) => {
          if (alive && current === epoch) {
            const detail = captureMessage(reason)
            error.value = detail
            notify(msg('无法收集：{error}', { error: detail }), 'error', 'collection')
          }
        })
      })
      .then((dispose) => {
        if (!alive) dispose()
        else stop = dispose
      })
      .catch(() => {
        if (!alive) return
        error.value = msg('无法启用收集监听，请重新打开 Repeaty。')
        notify(error.value, 'error', 'collection')
      })
  }
  onScopeDispose(() => {
    alive = false
    epoch++
    stop?.()
    pending.value = undefined
    if (platform.nativeCollection) void platform.bindCollectionScope('').catch(() => {})
  })
  const readClipboard = platform.nativeCollection
    ? async () => {
        const scope = workspace.scope.value,
          current = epoch
        try {
          await ready
          if (
            !alive ||
            current !== epoch ||
            !workspace.ready.value ||
            scope !== workspace.scope.value
          )
            throw new Error('学习库已变化，请重新操作。')
          const payload = await platform.captureClipboard(scope)
          if (!alive || current !== epoch || scope !== workspace.scope.value)
            throw new Error('学习库已变化，请重新操作。')
          return captureInput(payload)
        } catch (reason) {
          throw new LocalizedError(captureMessage(reason))
        }
      }
    : undefined
  return {
    readClipboard,
    pending,
    error,
    saving,
    retry: savePending,
    discard: () => {
      if (!saving.value) {
        pending.value = undefined
        error.value = ''
      }
    },
  }
}
