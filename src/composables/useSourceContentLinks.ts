import { computed, onUnmounted, shallowRef, watch } from 'vue'
import { createExportFile } from '@repeaty-platform'
import type { Source } from '../core/source-data'
import type { MaterialLocator } from '../core/material-data'
import { sourceAnchorOffset, sourceContentLinks } from '../core/source-content-links'

/** Accepted source links and attachments; no ambient paths, remote requests, or stale navigation. */
export function useSourceContentLinks(
  input: () => {
    source?: Source
    sources?: readonly Source[]
    text: string
    scope?: string
    read?: (id: string) => Promise<Blob | undefined>
    open?: (id: string, locator?: MaterialLocator) => void
  },
) {
  const error = shallowRef<unknown>()
  const targets = computed((previous: ReturnType<typeof sourceContentLinks> | undefined) => {
    const value = input(),
      next = sourceContentLinks(value.source, value.text, value.sources)
    if (!value.open) next.links.clear()
    if (
      previous &&
      JSON.stringify([...previous.links]) === JSON.stringify([...next.links]) &&
      JSON.stringify([...previous.resources]) === JSON.stringify([...next.resources])
    )
      return previous
    return next
  })
  const owned = new Set<string>()
  let generation = 0
  function clear() {
    generation++
    error.value = undefined
    for (const url of owned) URL.revokeObjectURL(url)
    owned.clear()
  }
  watch(
    [
      () => input().scope,
      () => input().source?.id,
      () => input().source?.mediaId,
      () => input().text,
    ],
    clear,
    { flush: 'sync' },
  )
  onUnmounted(clear)
  async function activate(reference?: string, resource?: string) {
    const sequence = generation,
      value = input(),
      read = value.read
    const current = () => generation === sequence
    error.value = undefined
    try {
      if (reference && value.open) {
        const target = targets.value.links.get(reference)
        const source = value.sources?.find((entry) => entry.id === target?.sourceId)
        if (!target || !source) return
        if (target.anchor && read) {
          const blob = await read(source.mediaId)
          if (
            !current() ||
            input().sources?.find((entry) => entry.id === source.id)?.mediaId !== source.mediaId
          )
            return
          const text = blob ? await blob.text() : undefined
          if (!current()) return
          const start = text === undefined ? undefined : sourceAnchorOffset(text, target.anchor)
          if (start !== undefined && text) {
            const end = Math.min(
              text.length,
              start + Math.max(1, text.slice(start).split('\n')[0]!.length),
            )
            value.open(source.id, {
              schemaVersion: 1,
              kind: 'text',
              sourceId: source.id,
              versionId: source.mediaId,
              start,
              end,
              quote: text.slice(start, end),
            })
            return
          }
        }
        if (current()) value.open(source.id)
      } else if (resource && read) {
        const target = targets.value.resources.get(resource)
        if (!target) return
        const blob = await read(target.mediaId)
        if (!current()) return
        if (!blob) throw new Error('附件缺失，请从完整备份恢复。')
        const name = target.path.split('/').at(-1) || 'attachment'
        if (createExportFile) {
          const stream = await createExportFile(name)
          if (!current()) {
            await stream.abort()
            return
          }
          await blob.stream().pipeTo(stream)
        } else {
          const url = URL.createObjectURL(blob),
            link = document.createElement('a')
          owned.add(url)
          link.href = url
          link.download = name
          link.click()
          setTimeout(() => {
            if (owned.delete(url)) URL.revokeObjectURL(url)
          }, 1000)
        }
      }
    } catch (issue) {
      if (current() && !(issue instanceof DOMException && issue.name === 'AbortError'))
        error.value = issue
    }
  }
  return { targets, error, activate }
}
