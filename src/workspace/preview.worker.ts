import { createPreviewReceiver, type PreviewScan, type PreviewPatch } from './preview'
const inspect = createPreviewReceiver()
self.onmessage = (
  event: MessageEvent<{ id: number; scan?: PreviewScan; patch?: PreviewPatch }>,
) => {
  try {
    self.postMessage({ id: event.data.id, changes: inspect(event.data) })
  } catch (error) {
    self.postMessage({
      id: event.data.id,
      error: error instanceof Error ? error.message : 'invalid-scan',
    })
  }
}
