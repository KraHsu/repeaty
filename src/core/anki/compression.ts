import { Decompress } from 'fzstd'

/** Check frame/window sizes before the decoder allocates a history window. */
export function decompressAnki(bytes: Uint8Array, limit: number): Uint8Array<ArrayBuffer> {
  let offset = 0
  function uint(length: number): number {
    if (offset + length > bytes.length) throw new Error('Truncated zstd header')
    let value = 0
    for (let i = 0; i < length; i++) value += bytes[offset++]! * 2 ** (8 * i)
    if (!Number.isSafeInteger(value)) throw new Error('Oversized zstd value')
    return value
  }
  if (uint(4) !== 0xfd2fb528) throw new Error('Invalid zstd frame')
  const descriptor = uint(1),
    single = Boolean(descriptor & 32),
    sizeFlag = descriptor >> 6
  if (descriptor & 8) throw new Error('Reserved zstd frame')
  let window = 0
  if (!single) {
    const value = uint(1),
      base = 2 ** (10 + (value >> 3))
    window = base + (base / 8) * (value & 7)
  }
  const dictFlag = descriptor & 3
  if (uint(dictFlag === 3 ? 4 : dictFlag)) throw new Error('Zstd dictionary not supported')
  const sizeBytes = sizeFlag ? 2 ** sizeFlag : single ? 1 : 0
  const declared = uint(sizeBytes) + (sizeFlag === 1 ? 256 : 0)
  if (single) window = declared
  if (declared > limit || window > Math.min(limit, 32 * 1024 * 1024))
    throw new Error('Zstd frame exceeds import limits')
  // Exports use one frame per file. Do not hand unchecked concatenated frames to
  // the decoder: a later frame could request an unbounded allocation.
  let last = false
  while (!last) {
    const block = uint(3),
      type = (block >> 1) & 3,
      size = block >>> 3
    last = Boolean(block & 1)
    if (type === 3 || size > 131072) throw new Error('Invalid zstd block')
    offset += type === 1 ? 1 : size
    if (offset > bytes.length) throw new Error('Truncated zstd block')
  }
  if (descriptor & 4) offset += 4
  if (offset !== bytes.length) throw new Error('Unexpected zstd data')
  const chunks: Uint8Array<ArrayBuffer>[] = []
  let size = 0
  const stream = new Decompress((chunk) => {
    size += chunk.length
    if (size > limit) throw new Error('Expanded zstd data exceeds import limits')
    chunks.push(new Uint8Array(chunk))
  })
  stream.push(bytes, true)
  if (sizeBytes && size !== declared) throw new Error('Zstd size mismatch')
  const result = new Uint8Array(size)
  let position = 0
  for (const chunk of chunks) {
    result.set(chunk, position)
    position += chunk.length
  }
  return result
}
