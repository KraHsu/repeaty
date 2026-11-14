import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }))
vi.mock('@tauri-apps/api/event', () => ({ listen: mocks.listen }))
import {
  bindCollectionScope,
  captureClipboard,
  directoryChoose,
  directoryRead,
  directoryDisconnect,
  directoryIndex,
  onCapture,
  takeCapture,
} from './collection'
beforeEach(() => {
  vi.clearAllMocks()
})
it('cancels the native index and rejects its late result after an abort', async () => {
  let finish!: (result: unknown) => void
  mocks.invoke.mockImplementation((command) =>
    command === 'collection_directory_index'
      ? new Promise((resolve) => {
          finish = resolve
        })
      : Promise.resolve(),
  )
  const controller = new AbortController()
  const request = directoryIndex('library-a', 'grant', controller.signal)
  controller.abort()
  expect(mocks.invoke).toHaveBeenCalledWith('collection_directory_cancel', {
    expectedScope: 'library-a',
    id: 'grant',
  })
  finish({ files: 10, skipped: 0, indexedAt: 1 })
  await expect(request).rejects.toMatchObject({ name: 'AbortError' })
  mocks.invoke.mockClear()
  await expect(directoryIndex('library-a', 'grant', controller.signal)).rejects.toMatchObject({
    name: 'AbortError',
  })
  expect(mocks.invoke).not.toHaveBeenCalled()
})
it('passes exact timestamps and scope with reads and decodes binary bytes', async () => {
  mocks.invoke.mockResolvedValue({ bytes: 'AP8B', size: 3, modified: '1793355291234567890' })
  const value = await directoryRead('library-a', 'grant', {
    path: '附件/图.png',
    size: 3,
    modified: '1793355291234567890',
  })
  expect(mocks.invoke).toHaveBeenCalledWith('collection_directory_read', {
    expectedScope: 'library-a',
    id: 'grant',
    path: '附件/图.png',
    expectedSize: 3,
    expectedModified: '1793355291234567890',
  })
  expect([...value.bytes]).toEqual([0, 255, 1])
})
it('reconnects only through native picker and disconnects only the device grant', async () => {
  mocks.invoke.mockResolvedValue(null)
  expect(await directoryChoose('library-a', 'retained-id')).toBeNull()
  expect(mocks.invoke).toHaveBeenLastCalledWith('collection_directory_choose', {
    expectedScope: 'library-a',
    id: 'retained-id',
  })
  await directoryDisconnect('library-a', 'retained-id')
  expect(mocks.invoke).toHaveBeenLastCalledWith('collection_directory_disconnect', {
    expectedScope: 'library-a',
    id: 'retained-id',
  })
  await bindCollectionScope('')
  expect(mocks.invoke).toHaveBeenLastCalledWith('collection_bind_scope', { scope: '' })
})
it('keeps capture ownership and binary attachments when delivering clipboard or global captures', async () => {
  mocks.invoke.mockResolvedValue({
    mode: 'clipboard',
    text: null,
    html: null,
    files: [{ name: '图.png', path: '图.png', type: 'image/png', bytes: 'AP8B', size: 3 }],
  })
  expect([...(await captureClipboard('library-a')).files[0]!.bytes]).toEqual([0, 255, 1])
  await takeCapture('library-a', 'capture-id')
  expect(mocks.invoke).toHaveBeenLastCalledWith('collection_capture_take', {
    expectedScope: 'library-a',
    id: 'capture-id',
  })
  const dispose = vi.fn(),
    receive = vi.fn()
  mocks.listen.mockImplementation(async (_event, callback) => {
    callback({ payload: { id: 'capture-id', scope: 'library-a', error: null } })
    return dispose
  })
  expect(await onCapture(receive)).toBe(dispose)
  expect(receive).toHaveBeenCalledWith({ id: 'capture-id', scope: 'library-a', error: null })
})
