// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, type App } from 'vue'
import SourceContext from './SourceContext.vue'
import { prepareSource, sourceExcerpt } from '../core/sources'
import type { Source, SourceExcerpt } from '../core/source-data'

vi.mock('../plugins/manager', () => ({
  usePluginManager: () => ({ pluginRuntime: { installations: [] } }),
}))
vi.mock('./AppModal.vue', () => ({
  default: defineComponent({
    setup:
      (_, { slots }) =>
      () =>
        h('section', slots.default?.()),
  }),
}))
let app: App | undefined
const fonts = Object.getOwnPropertyDescriptor(document, 'fonts')
beforeEach(() => {
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: { ready: Promise.resolve() },
  })
})
afterEach(() => {
  app?.unmount()
  app = undefined
  document.body.replaceChildren()
  if (fonts) Object.defineProperty(document, 'fonts', fonts)
  else Reflect.deleteProperty(document, 'fonts')
})
function mount(source: Source, excerpt: SourceExcerpt, text: string) {
  const read = vi.fn(async () => text),
    host = document.createElement('div')
  document.body.append(host)
  app = createApp({ render: () => h(SourceContext, { source, excerpt, sources: [source], read }) })
  app.mount(host)
  return { host, read }
}

it.each(['plain', 'markdown'] as const)(
  'highlights an offset-only excerpt in a collected %s document before showing any preview',
  async (format) => {
    const text = '# Header\n\nRepeated quote\n\nRepeated quote',
      { source } = prepareSource({ title: 'Collected note', content: text, format, url: '' })
    source.document = {
      schemaVersion: 1,
      providerId: 'repeaty-collection',
      format,
      originalMediaId: source.mediaId,
    }
    if (format === 'markdown')
      source.reading = {
        offset: 0,
        fraction: 0,
        view: 'preview',
        updatedAt: new Date().toISOString(),
      }
    const start = text.lastIndexOf('Repeated quote'),
      excerpt = sourceExcerpt(source, text, start, text.length),
      { host } = mount(source, excerpt, text)
    expect(excerpt.locator).toBeUndefined()
    await vi.waitFor(() =>
      expect(host.querySelector('.source-original mark')?.textContent).toBe(excerpt.quote),
    )
    const original = host.querySelector('.source-original')!,
      mark = original.querySelector('mark')!
    expect(original.textContent).toBe(text)
    expect(mark.previousSibling?.textContent).toBe(text.slice(0, start))
    expect(host.querySelector('.source-markdown-preview')).toBeNull()
    if (format === 'markdown') {
      const toggle = [...host.querySelectorAll('button')].find((button) =>
        button.textContent?.includes('阅读 Markdown 预览'),
      )!
      toggle.click()
      await nextTick()
      expect(host.querySelector('.source-markdown-preview')).not.toBeNull()
      toggle.click()
      await nextTick()
      expect(host.querySelector('.source-original mark')?.textContent).toBe(excerpt.quote)
    }
  },
)

it('locates an offset-only excerpt in its saved document version after the material changes', async () => {
  const text = 'Original accepted body',
    { source: original } = prepareSource({
      title: 'Old note',
      content: text,
      format: 'markdown',
      url: '',
    }),
    { source: replacement } = prepareSource({
      title: 'New note',
      content: 'Replacement body',
      format: 'markdown',
      url: '',
    })
  const excerpt = sourceExcerpt(original, text, 9, 17)
  const source: Source = {
    ...replacement,
    id: original.id,
    versions: [
      {
        title: original.title,
        url: original.url,
        format: original.format,
        mediaId: original.mediaId,
        characters: original.characters,
        acceptedAt: original.createdAt,
        document: {
          schemaVersion: 1,
          providerId: 'repeaty-collection',
          format: 'markdown',
          originalMediaId: original.mediaId,
        },
      },
    ],
  }
  const { host, read } = mount(source, excerpt, text)
  await vi.waitFor(() =>
    expect(host.querySelector('.source-original mark')?.textContent).toBe('accepted'),
  )
  expect(read).toHaveBeenCalledWith(original.id, expect.any(AbortSignal), original.mediaId)
  expect(host.textContent).toContain('正在查看摘录保存时的版本')
})
