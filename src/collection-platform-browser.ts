import type {
  DirectoryConnection,
  DirectoryEntry,
  DirectoryListing,
  DirectoryContent,
  DirectoryIndexStatus,
  DirectorySearchResult,
  CaptureConfiguration,
  CaptureStatus,
  CapturePayload,
  CaptureEvent,
} from './desktop/collection'
export const nativeCollection = false
const unavailable = () => Promise.reject(new Error('此操作需要桌面版。'))
export const bindCollectionScope = async (_scope: string): Promise<void> => {}
export const directoryConnections = async (_scope: string): Promise<DirectoryConnection[]> => []
export const directoryChoose = (
  _scope: string,
  _id?: string,
): Promise<DirectoryConnection | null> => unavailable()
export const directoryList = (
  _scope: string,
  _id: string,
  _signal?: AbortSignal,
): Promise<DirectoryListing> => unavailable()
export const directoryRead = (
  _scope: string,
  _id: string,
  _entry: DirectoryEntry,
  _signal?: AbortSignal,
): Promise<DirectoryContent> => unavailable()
export const directoryDisconnect = (_scope: string, _id: string): Promise<void> => unavailable()
export const directoryIndex = (
  _scope: string,
  _id: string,
  _signal?: AbortSignal,
): Promise<DirectoryIndexStatus> => unavailable()
export const directorySearch = (
  _scope: string,
  _id: string,
  _query: string,
  _limit = 50,
): Promise<DirectorySearchResult> => unavailable()
export const downloadOriginal = (
  _scope: string,
  _request: { url: string; filename: string; format: 'pdf' | 'epub' },
): Promise<{ name: string; type: string; size: number; bytes: Uint8Array } | null> => unavailable()
export const captureStatus = (): Promise<CaptureStatus> => unavailable()
export const configureCapture = (_configuration: CaptureConfiguration): Promise<CaptureStatus> =>
  unavailable()
export const captureClipboard = (_scope: string): Promise<CapturePayload> => unavailable()
export const takeCapture = (_scope: string, _id: string): Promise<CapturePayload> => unavailable()
export const onCapture =
  async (_callback: (event: CaptureEvent) => void): Promise<() => void> =>
  () => {}
