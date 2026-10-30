import type { ImageData } from '../src/model'
export const imageData = (): ImageData => ({
  kind: 'image',
  mediaId: 'original.png',
  width: 600,
  height: 400,
  rotation: 0,
  mode: 'one',
  regions: [
    { id: 'region-a', label: '细胞核', x: 0.1, y: 0.2, width: 0.2, height: 0.3 },
    { id: 'region-b', label: '细胞壁', x: 0.5, y: 0.1, width: 0.1, height: 0.2 },
  ],
})
export function png(width = 600, height = 400) {
  const bytes = new Uint8Array(24),
    view = new DataView(bytes.buffer)
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82])
  view.setUint32(16, width)
  view.setUint32(20, height)
  return bytes
}
export const source = {
  id: 'source',
  versionId: 'version-old',
  title: 'cell.png',
  format: 'plain' as const,
  locked: false,
  document: {
    schemaVersion: 1 as const,
    providerId: 'visual-occlusion',
    readerId: 'image',
    format: 'image',
    originalMediaId: 'original.png',
  },
}
