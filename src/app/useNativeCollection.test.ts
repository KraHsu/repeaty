// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { computed, effectScope, ref } from 'vue'
import type { CollectionHostApi } from '@repeaty/plugin-api'
import type { CaptureEvent, CapturePayload } from '../desktop/collection'
import type { useLibrary } from '../composables/useLibrary'
import { setLocale, t } from '../i18n'
import { useNativeCollection } from './useNativeCollection'

const bridge = vi.hoisted(() => ({
  bindCollectionScope: vi.fn(),
  onCapture: vi.fn(),
  takeCapture: vi.fn(),
  captureClipboard: vi.fn(),
  notify: vi.fn(),
}))
vi.mock('@repeaty-collection-platform', () => ({ nativeCollection: true, ...bridge }))
vi.mock('../notifications', () => ({ useNotifications: () => ({ notify: bridge.notify }) }))

let receive: (event: CaptureEvent) => void
const cleanups: (() => void)[] = []
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
async function settle() {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}
function application() {
  const scope = ref('library-a'),
    ready = ref(true),
    owner = effectScope()
  const prepareCollection = vi.fn().mockResolvedValue({ id: 'plan', revision: 4 })
  const commitCollection = vi.fn().mockResolvedValue(undefined)
  const discardCollection = vi.fn()
  const api = {
    prepareCollection,
    commitCollection,
    discardCollection,
  } as unknown as CollectionHostApi
  const capture = owner.run(() =>
    useNativeCollection(
      { scope, ready } as unknown as ReturnType<typeof useLibrary>,
      computed(() => api),
    ),
  )!
  cleanups.push(() => owner.stop())
  return { scope, ready, owner, capture, prepareCollection, commitCollection, discardCollection }
}
const payload: CapturePayload = { mode: 'clipboard', text: 'Remember this', html: null, files: [] }

beforeEach(() => {
  vi.resetAllMocks()
  setLocale('en')
  bridge.bindCollectionScope.mockResolvedValue(undefined)
  bridge.onCapture.mockImplementation(async (callback) => {
    receive = callback
    return vi.fn()
  })
  bridge.takeCapture.mockResolvedValue(payload)
  bridge.captureClipboard.mockResolvedValue(payload)
})
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) cleanup()
  await settle()
  setLocale('zh-CN')
})

it('ignores a failed old binding after a library switch and localizes current binding failures', async () => {
  const old = deferred<void>()
  bridge.bindCollectionScope.mockReturnValueOnce(old.promise)
  const { scope, ready, capture } = application()
  scope.value = 'library-b'
  old.reject('capture-unavailable')
  await settle()
  expect(capture.error.value).toBe('')
  bridge.bindCollectionScope.mockRejectedValueOnce('capture-config-invalid')
  ready.value = false
  await settle()
  expect(t(capture.error.value)).toBe(
    'Quick capture settings are invalid. Configure and save them again.',
  )
})

it('handles listener registration failure without an unhandled rejection', async () => {
  bridge.onCapture.mockRejectedValueOnce(new Error('event bridge offline'))
  const { capture } = application()
  await settle()
  expect(t(capture.error.value)).toBe('Could not start the capture listener. Reopen Repeaty.')
  expect(t(bridge.notify.mock.calls[0]![0])).toBe(
    'Could not start the capture listener. Reopen Repeaty.',
  )
})

it('disposes a listener that registers after unmount and ignores late binding errors', async () => {
  const registration = deferred<() => void>(),
    binding = deferred<void>(),
    dispose = vi.fn()
  bridge.onCapture.mockReturnValueOnce(registration.promise)
  bridge.bindCollectionScope.mockReturnValueOnce(binding.promise)
  const { owner, capture } = application()
  owner.stop()
  registration.resolve(dispose)
  binding.reject('capture-unavailable')
  await settle()
  expect(dispose).toHaveBeenCalledOnce()
  expect(capture.error.value).toBe('')
  expect(bridge.notify).not.toHaveBeenCalled()
  expect(bridge.bindCollectionScope).toHaveBeenLastCalledWith('')
})

it('does not take a capture whose original binding finished after switching away and back', async () => {
  const binding = deferred<void>()
  bridge.bindCollectionScope.mockReturnValueOnce(binding.promise)
  const { scope, capture } = application()
  receive({ scope: 'library-a', id: 'old', error: null })
  scope.value = 'library-b'
  scope.value = 'library-a'
  binding.resolve()
  await settle()
  expect(bridge.takeCapture).not.toHaveBeenCalled()
  expect(capture.pending.value).toBeUndefined()
})

it('ignores errors from an old capture request and events for a library that is not ready', async () => {
  const request = deferred<CapturePayload>()
  bridge.takeCapture.mockReturnValueOnce(request.promise)
  const { scope, ready, capture, prepareCollection } = application()
  receive({ scope: 'library-a', id: 'old', error: null })
  await settle()
  scope.value = 'library-b'
  request.reject('capture-expired')
  ready.value = false
  receive({ scope: 'library-b', id: 'not-ready', error: 'clipboard-empty' })
  await settle()
  expect(capture.error.value).toBe('')
  expect(bridge.notify).not.toHaveBeenCalled()
  expect(prepareCollection).not.toHaveBeenCalled()
})

it('retains a failed capture for retry and keeps its error translatable', async () => {
  const { capture, commitCollection, discardCollection } = application()
  commitCollection.mockRejectedValueOnce('capture-size-limit')
  receive({ scope: 'library-a', id: 'captured', error: null })
  await settle()
  expect(capture.pending.value?.payload.text).toBe(payload.text)
  expect(capture.saving.value).toBe(false)
  expect(t(capture.error.value)).toBe(
    'The capture exceeds the size limit. Reduce its size and retry.',
  )
  setLocale('zh-CN')
  expect(t(capture.error.value)).toBe('收集内容超过大小限制，请减少内容后重试。')
  expect(t(bridge.notify.mock.calls[0]![0])).toContain('收集未保存：收集内容超过大小限制')
  await capture.retry()
  expect(commitCollection).toHaveBeenCalledTimes(2)
  expect(discardCollection).toHaveBeenCalledTimes(2)
  expect(capture.pending.value).toBeUndefined()
  expect(capture.error.value).toBe('')
})

it('rejects a stale clipboard result even when the same library is ready again', async () => {
  const clipboard = deferred<CapturePayload>()
  bridge.captureClipboard.mockReturnValueOnce(clipboard.promise)
  const { ready, capture } = application()
  const read = capture.readClipboard!()
  const rejected = expect(read).rejects.toThrow('The library has changed. Please try again.')
  await settle()
  ready.value = false
  ready.value = true
  clipboard.resolve(payload)
  await rejected
})

it('translates native clipboard failures for the collection dialog', async () => {
  bridge.captureClipboard.mockRejectedValueOnce('clipboard-empty')
  const { capture } = application()
  await expect(capture.readClipboard!()).rejects.toThrow('The clipboard has no content to capture.')
})
