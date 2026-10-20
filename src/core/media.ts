import { msg, LocalizedError } from '../i18n'
import { MAX_MEDIA_BYTES, mediaSchema, type MediaUpload } from './model'

export function prepareMedia(file: File): MediaUpload {
  if (!file.size || file.size > MAX_MEDIA_BYTES)
    throw new LocalizedError(msg('图片或音频文件不能为空，且不能超过 10 MB。'))
  const result = mediaSchema.safeParse({
    id: crypto.randomUUID(),
    name: file.name,
    type: file.type,
    size: file.size,
    createdAt: new Date().toISOString(),
  })
  if (!result.success || file.type.startsWith('text/'))
    throw new LocalizedError(
      msg('支持 PNG、JPEG、WebP、GIF 图片及 MP3、WAV、OGG、M4A、WebM、FLAC、AAC 音频。'),
    )
  return { meta: result.data, blob: file }
}
