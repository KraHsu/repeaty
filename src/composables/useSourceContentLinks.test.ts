// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, ref, type App } from 'vue'
import { prepareSource } from '../core/sources'
import { useSourceContentLinks } from './useSourceContentLinks'

vi.mock('@repeaty-platform', () => ({ createExportFile: undefined }))
let app: App | undefined
afterEach(() => {
  app?.unmount()
  app = undefined
  document.body.replaceChildren()
  vi.restoreAllMocks()
})
it('ignores a late anchor read after switching libraries and preserves actions across metadata-only saves', async () => {
  const { source } = prepareSource({
    title: 'A',
    content: '[B](repeaty-source:B.md#Heading)',
    format: 'markdown',
    url: '',
  })
  source.binding = {
    connectionId: 'connection',
    key: 'A.md',
    fingerprint: 'a'.repeat(64),
    acceptedMediaId: source.mediaId,
  }
  const target = {
    ...source,
    id: 'b',
    mediaId: 'body-b',
    binding: { ...source.binding, key: 'B.md' },
  }
  const current = ref(source),
    scope = ref('first'),
    open = vi.fn()
  let finish: (blob: Blob) => void = () => {}
  const read = vi.fn(
    () =>
      new Promise<Blob>((resolve) => {
        finish = resolve
      }),
  )
  let links: ReturnType<typeof useSourceContentLinks>
  app = createApp({
    setup() {
      links = useSourceContentLinks(() => ({
        source: current.value,
        sources: [target],
        text: '[B](repeaty-source:B.md#Heading)',
        scope: scope.value,
        read,
        open,
      }))
      return () => h('div')
    },
  })
  const host = document.createElement('div')
  document.body.append(host)
  app.mount(host)
  const first = links!.activate('repeaty-source:B.md#Heading')
  scope.value = 'second'
  await nextTick()
  finish(new Blob(['# Heading']))
  await first
  expect(open).not.toHaveBeenCalled()
  const second = links!.activate('repeaty-source:B.md#Heading')
  current.value = {
    ...source,
    reading: { offset: 1, fraction: 0, view: 'preview', updatedAt: new Date().toISOString() },
  }
  await nextTick()
  finish(new Blob(['# Heading']))
  await second
  expect(open).toHaveBeenCalledWith(
    'b',
    expect.objectContaining({ versionId: 'body-b', start: 0, quote: '# Heading' }),
  )
})
