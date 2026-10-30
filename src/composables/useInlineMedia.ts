import { onUnmounted, shallowRef, watch, type MaybeRefOrGetter, toValue } from 'vue'
import type { InlineMedia } from '../core/inline-media-data'

export type InlineMediaReference = Pick<InlineMedia[number], 'url' | 'mediaId'>

/** Only immutable, accepted media are turned into URLs. Working paths never reach the webview. */
export function useInlineMedia(
  input: MaybeRefOrGetter<{
    text: string
    media?: readonly InlineMediaReference[]
    read?: (id: string) => Promise<Blob | undefined>
  }>,
) {
  const urls = shallowRef<ReadonlyMap<string, string>>(new Map())
  const error = shallowRef(false)
  let generation = 0
  let owned: string[] = []
  function clear() {
    for (const url of owned) URL.revokeObjectURL(url)
    owned = []
    urls.value = new Map()
  }
  watch(
    () => toValue(input),
    async ({ text, media, read }) => {
      const sequence = ++generation
      clear()
      error.value = false
      if (!read || !media?.length) return
      const { inlineReferences } = await import('../core/inline-media')
      if (sequence !== generation) return
      const used = new Set(
        inlineReferences(text)
          .filter((ref) => ref.media)
          .map((ref) => ref.url),
      )
      const loaded = new Map<string, string>(),
        result = new Map<string, string>()
      for (const ref of media) {
        if (!used.has(ref.url)) continue
        try {
          let url = loaded.get(ref.mediaId)
          if (!url) {
            const blob = await read(ref.mediaId)
            if (sequence !== generation) return
            if (
              !blob ||
              !/^(image\/(png|jpeg|gif|webp)|audio\/(mpeg|wav|x-wav|ogg|mp4|webm|flac|aac))$/.test(
                blob.type,
              )
            )
              throw new Error('missing-media')
            url = URL.createObjectURL(blob)
            owned.push(url)
            loaded.set(ref.mediaId, url)
          }
          result.set(ref.url, url)
        } catch {
          if (sequence === generation) error.value = true
        }
      }
      if (sequence === generation) urls.value = result
    },
    { immediate: true },
  )
  onUnmounted(() => {
    generation++
    clear()
  })
  return { urls, error }
}
