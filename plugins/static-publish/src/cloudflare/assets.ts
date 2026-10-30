import { blake3 } from '@noble/hashes/blake3.js'
import { validPath, type SiteFile } from '../model'

export interface UploadAsset {
  path: string
  type: string
  hash: string
  base64: string
}
export function prepareAssets(files: readonly SiteFile[]): UploadAsset[] {
  if (!files.length || files.length > 20_000) throw new Error('cloudflare-file-limit')
  const paths = new Set<string>()
  let total = 0
  return files.map((file) => {
    if (!validPath(file.path) || paths.has(file.path)) throw new Error('cloudflare-invalid-path')
    paths.add(file.path)
    if (file.bytes.byteLength > 23 * 1024 * 1024) throw new Error('cloudflare-file-limit')
    total += file.bytes.byteLength
    if (total > 64 * 1024 * 1024) throw new Error('cloudflare-total-limit')
    let binary = ''
    for (let offset = 0; offset < file.bytes.length; offset += 16_384)
      binary += String.fromCharCode(...file.bytes.subarray(offset, offset + 16_384))
    const base64 = btoa(binary)
    const name = file.path.split('/').at(-1)!
    const extension = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : ''
    // Pages Direct Upload uses the same key as Wrangler: BLAKE3(base64 + extension).
    const hash = [...blake3(new TextEncoder().encode(base64 + extension))]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')
      .slice(0, 32)
    return { path: file.path, type: file.type, hash, base64 }
  })
}
