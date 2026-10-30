import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

/** Device-local grants; only these IDs, never arbitrary paths, can be read. */
export interface DirectoryConnection {
  id: string
  name: string
  path: string
  available: boolean
}
export interface DirectoryEntry {
  path: string
  size: number
  /** Exact decimal nanoseconds. Do not convert to a JS number. */
  modified: string
}
export interface DirectoryListing {
  files: DirectoryEntry[]
  skipped: {
    path: string
    reason: 'private-or-temporary' | 'link' | 'file-too-large' | 'not-a-file'
  }[]
  complete: true
}
export interface DirectoryContent {
  bytes: Uint8Array
  size: number
  modified: string
}
export interface DirectoryIndexStatus {
  files: number
  skipped: number
  indexedAt: number
}
export interface DirectorySearchResult {
  hits: (DirectoryEntry & { snippet: string })[]
  more: boolean
  indexedAt: number
}
export interface CaptureConfiguration {
  enabled: boolean
  shortcut: string
  mode: 'selection' | 'clipboard'
}
export interface CaptureStatus {
  configuration: CaptureConfiguration
  registered: boolean
  error: string | null
  selection: boolean
  permission: 'not-required' | 'granted' | 'accessibility-required'
  shortcutAvailable: boolean
}
export interface CapturePayload {
  mode: CaptureConfiguration['mode']
  text: string | null
  html: string | null
  files: { name: string; path: string; type: string; bytes: Uint8Array; size: number }[]
}
export interface CaptureEvent {
  id: string
  scope: string
  error: string | null
}
type EncodedPayload = Omit<CapturePayload, 'files'> & {
  files: (Omit<CapturePayload['files'][number], 'bytes'> & { bytes: string })[]
}
function decode(bytes: string): Uint8Array {
  return Uint8Array.from(atob(bytes), (character) => character.charCodeAt(0))
}
function decodePayload(payload: EncodedPayload): CapturePayload {
  return {
    ...payload,
    files: payload.files.map((file) => ({ ...file, bytes: decode(file.bytes) })),
  }
}
/** Bind on startup/switch; an empty scope immediately revokes all in-flight operations. */
export const bindCollectionScope = (scope: string) =>
  invoke<void>('collection_bind_scope', { scope })
export const directoryConnections = (expectedScope: string) =>
  invoke<DirectoryConnection[]>('collection_directories', { expectedScope })
/** Reauthorization replaces an existing grant only after the native picker succeeds. */
export const directoryChoose = (expectedScope: string, id?: string) =>
  invoke<DirectoryConnection | null>('collection_directory_choose', {
    expectedScope,
    id: id ?? null,
  })
export const directoryCancel = (expectedScope: string, id: string) =>
  invoke<void>('collection_directory_cancel', { expectedScope, id })
async function cancellable<T>(
  expectedScope: string,
  id: string,
  signal: AbortSignal | undefined,
  task: () => Promise<T>,
): Promise<T> {
  signal?.throwIfAborted()
  let cancellation: Promise<void> | undefined
  const cancel = () => {
    cancellation = directoryCancel(expectedScope, id).catch(() => {})
  }
  signal?.addEventListener('abort', cancel, { once: true })
  try {
    const result = await task()
    signal?.throwIfAborted()
    return result
  } catch (error) {
    signal?.throwIfAborted()
    throw error
  } finally {
    signal?.removeEventListener('abort', cancel)
    // A subsequent scan must not receive an older scan's delayed cancellation.
    await cancellation
  }
}
export const directoryList = (expectedScope: string, id: string, signal?: AbortSignal) =>
  cancellable(expectedScope, id, signal, () =>
    invoke<DirectoryListing>('collection_directory_list', { expectedScope, id }),
  )
export async function directoryRead(
  expectedScope: string,
  id: string,
  entry: DirectoryEntry,
  signal?: AbortSignal,
): Promise<DirectoryContent> {
  const value = await cancellable(expectedScope, id, signal, () =>
    invoke<{ bytes: string; size: number; modified: string }>('collection_directory_read', {
      expectedScope,
      id,
      path: entry.path,
      expectedSize: entry.size,
      expectedModified: entry.modified,
    }),
  )
  return { ...value, bytes: decode(value.bytes) }
}
/** Revokes only the device grant. Imported documents/history remain in the learning library. */
export const directoryDisconnect = (expectedScope: string, id: string) =>
  invoke<void>('collection_directory_disconnect', { expectedScope, id })
/** Bounded read-only rebuild into a device SQLite cache; never writes the learning library. */
export const directoryIndex = (expectedScope: string, id: string, signal?: AbortSignal) =>
  cancellable(expectedScope, id, signal, () =>
    invoke<DirectoryIndexStatus>('collection_directory_index', { expectedScope, id }),
  )
export const directorySearch = (expectedScope: string, id: string, query: string, limit = 50) =>
  invoke<DirectorySearchResult>('collection_directory_search', { expectedScope, id, query, limit })
export const captureStatus = () => invoke<CaptureStatus>('collection_capture_status')
export const configureCapture = (configuration: CaptureConfiguration) =>
  invoke<CaptureStatus>('collection_capture_configure', { configuration })
export const captureClipboard = async (expectedScope: string) =>
  decodePayload(await invoke<EncodedPayload>('collection_capture_clipboard', { expectedScope }))
/** A global capture is held for 60 seconds and consumed once, only by its original library. */
export const takeCapture = async (expectedScope: string, id: string) =>
  decodePayload(await invoke<EncodedPayload>('collection_capture_take', { expectedScope, id }))
export const onCapture = (callback: (event: CaptureEvent) => void) =>
  listen<CaptureEvent>('repeaty-capture', (event) => callback(event.payload))
/** Invoke only after the user clicks Get original. The native origin confirmation cannot be bypassed. */
export async function downloadOriginal(
  expectedScope: string,
  request: { url: string; filename: string; format: 'pdf' | 'epub' },
) {
  const result = await invoke<{ name: string; type: string; size: number; bytes: string } | null>(
    'collection_download',
    { expectedScope, ...request },
  )
  return result && { ...result, bytes: decode(result.bytes) }
}
