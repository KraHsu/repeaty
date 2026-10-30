import { MAX_IMAGE_BYTES, MAX_IMAGE_PIXELS, validRect } from './model'
export interface ImageInfo {
  width: number
  height: number
  type: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'
}
const text = (bytes: Uint8Array, from: number, to: number) =>
  String.fromCharCode(...bytes.slice(from, to))
export function imageInfo(bytes: Uint8Array): ImageInfo {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let result: ImageInfo | undefined
  if (
    bytes.length >= 24 &&
    bytes[0] === 137 &&
    text(bytes, 1, 4) === 'PNG' &&
    text(bytes, 12, 16) === 'IHDR'
  )
    result = { width: view.getUint32(16), height: view.getUint32(20), type: 'image/png' }
  else if (bytes.length >= 10 && ['GIF87a', 'GIF89a'].includes(text(bytes, 0, 6)))
    result = { width: view.getUint16(6, true), height: view.getUint16(8, true), type: 'image/gif' }
  else if (bytes.length >= 30 && text(bytes, 0, 4) === 'RIFF' && text(bytes, 8, 12) === 'WEBP') {
    const codec = text(bytes, 12, 16)
    if (codec === 'VP8X')
      result = {
        width: 1 + bytes[24]! + (bytes[25]! << 8) + (bytes[26]! << 16),
        height: 1 + bytes[27]! + (bytes[28]! << 8) + (bytes[29]! << 16),
        type: 'image/webp',
      }
    else if (codec === 'VP8 ' && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a)
      result = {
        width: view.getUint16(26, true) & 0x3fff,
        height: view.getUint16(28, true) & 0x3fff,
        type: 'image/webp',
      }
    else if (codec === 'VP8L' && bytes[20] === 0x2f) {
      const bits = view.getUint32(21, true)
      result = {
        width: 1 + (bits & 0x3fff),
        height: 1 + ((bits >>> 14) & 0x3fff),
        type: 'image/webp',
      }
    }
  } else if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let index = 2
    while (index + 4 <= bytes.length) {
      if (bytes[index++] !== 0xff) throw new Error('图片头损坏。')
      while (bytes[index] === 0xff) index++
      const marker = bytes[index++]!
      if (marker === 0xd9 || marker === 0xda) break
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
      const size = view.getUint16(index)
      if (size < 2 || index + size > bytes.length) break
      if (
        [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(
          marker,
        ) &&
        size >= 8
      ) {
        result = {
          width: view.getUint16(index + 5),
          height: view.getUint16(index + 3),
          type: 'image/jpeg',
        }
        break
      }
      index += size
    }
  }
  if (!result || !result.width || !result.height)
    throw new Error('无法读取图片尺寸，请使用完整的 PNG、JPEG、WebP 或 GIF 文件。')
  if (
    result.width > 20_000 ||
    result.height > 20_000 ||
    result.width * result.height > MAX_IMAGE_PIXELS
  )
    throw new Error('图片最多 4000 万像素，单边不超过 20000 像素。')
  return result
}
export async function inspectImage(blob: Blob, signal?: AbortSignal) {
  if (!blob.size || blob.size > MAX_IMAGE_BYTES) throw new Error('图片文件最大 10 MiB。')
  signal?.throwIfAborted()
  const info = imageInfo(new Uint8Array(await blob.slice(0, 512 * 1024).arrayBuffer()))
  signal?.throwIfAborted()
  return info
}
export async function cropImage(blob: Blob, rect: import('./model').Rect): Promise<Blob> {
  if (!validRect(rect)) throw new Error('无效图片区域。')
  const info = await inspectImage(blob)
  const bitmap = await createImageBitmap(blob.slice(0, blob.size, info.type))
  try {
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(rect.width * bitmap.width))
    canvas.height = Math.max(1, Math.round(rect.height * bitmap.height))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('无法创建图片画布。')
    context.drawImage(
      bitmap,
      rect.x * bitmap.width,
      rect.y * bitmap.height,
      rect.width * bitmap.width,
      rect.height * bitmap.height,
      0,
      0,
      canvas.width,
      canvas.height,
    )
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (value) => (value ? resolve(value) : reject(new Error('图片导出失败。'))),
        'image/png',
      ),
    )
  } finally {
    bitmap.close()
  }
}
