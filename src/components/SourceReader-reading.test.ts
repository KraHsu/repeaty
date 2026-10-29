// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, ref, type App } from 'vue'
import SourceReader from './SourceReader.vue'
import { prepareSource } from '../core/sources'

vi.mock('../plugins/manager', () => ({
  usePluginManager: () => ({ pluginRuntime: { installations: [] } }),
}))
let app: App | undefined
afterEach(() => {
  app?.unmount()
  app = undefined
  document.body.replaceChildren()
})
it('selects the second rendered occurrence and emits version-scoped edits and internal links', async () => {
  const text = '**same**\n\n**same**\n\n- [ ] Task\n\n[[source:stable|Guide]]'
  const { source } = prepareSource({ title: 'Reader', content: text, format: 'markdown', url: '' })
  const select = vi.fn(),
    change = vi.fn(),
    wiki = vi.fn(),
    preview = vi.fn()
  const editable = ref(true)
  const host = document.createElement('div')
  document.body.append(host)
  app = createApp({
    render: () =>
      h(SourceReader, {
        source,
        text,
        scope: 'library-one',
        editable: editable.value,
        onSelect: select,
        onChangeText: change,
        onWiki: wiki,
        onWikiPreview: preview,
      }),
  })
  app.mount(host)
  await nextTick()
  const rendered = host.querySelector('.source-markdown-preview')!
  expect(rendered).not.toBeNull()
  const strong = rendered.querySelectorAll('strong')[1]!
  const node = strong.querySelector('span')!.firstChild!
  const range = document.createRange()
  range.setStart(node, 0)
  range.setEnd(node, 4)
  document.getSelection()!.removeAllRanges()
  document.getSelection()!.addRange(range)
  rendered.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
  const start = text.lastIndexOf('same')
  expect(select).toHaveBeenLastCalledWith(
    source.id,
    start,
    start + 4,
    expect.objectContaining({ versionId: source.mediaId, quote: 'same' }),
  )
  const task = host.querySelector<HTMLElement>('[data-reading-task]')!
  task.click()
  expect(change).toHaveBeenCalledWith({
    sourceId: source.id,
    mediaId: source.mediaId,
    scope: 'library-one',
    content: text.replace('[ ]', '[x]'),
  })
  expect(source.mediaId).toBeDefined()
  expect(task.getAttribute('aria-checked')).toBe('false') // No optimistic mutation before persistence.
  editable.value = false
  await nextTick()
  host.querySelector<HTMLElement>('[data-reading-task]')!.click()
  expect(change).toHaveBeenCalledTimes(1)
  expect(host.querySelector('[data-reading-task]')!.getAttribute('aria-disabled')).toBe('true')
  const link = host.querySelector<HTMLElement>('[data-wiki-target]')!
  expect(link.getAttribute('href')).toBeNull()
  link.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
  link.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
  )
  expect(preview).toHaveBeenCalledWith('source:stable')
  expect(wiki).toHaveBeenCalledWith('source:stable')
})
