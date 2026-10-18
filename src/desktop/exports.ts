import { invoke } from '@tauri-apps/api/core'
export async function createExportFile(filename: string): Promise<WritableStream<Uint8Array>> {
  const token = await invoke<string | null>('export_begin', { filename })
  if (!token) throw new DOMException('Canceled', 'AbortError')
  return new WritableStream<Uint8Array>({
    async write(bytes) {
      for (let start = 0; start < bytes.length; start += 1024 * 1024) {
        const chunk = bytes.subarray(start, start + 1024 * 1024)
        let binary = ''
        for (let i = 0; i < chunk.length; i += 32768)
          binary += String.fromCharCode(...chunk.subarray(i, i + 32768))
        try {
          await invoke<void>('export_write', { token, chunk: btoa(binary) })
        } catch (error) {
          await invoke<void>('export_cancel', { token }).catch(() => {})
          throw error
        }
      }
    },
    close: () => invoke<void>('export_finish', { token }),
    abort: () => invoke<void>('export_cancel', { token }).catch(() => {}),
  })
}
