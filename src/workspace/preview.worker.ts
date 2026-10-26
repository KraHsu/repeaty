import { inspectPreview, type PreviewScan } from './preview'
self.onmessage = (event: MessageEvent<{ id: number; scan: PreviewScan }>) => {
  try {
    self.postMessage({ id: event.data.id, changes: inspectPreview(event.data.scan) })
  } catch (error) {
    self.postMessage({
      id: event.data.id,
      error: error instanceof Error ? error.message : 'invalid-scan',
    })
  }
}
