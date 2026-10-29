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
  vi.restoreAllMocks()
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

it('preserves preview nodes, selection and focus while reading progress is being saved', async () => {
  const text = '**same**\n\n**same**\n\n- [ ] Task'
  const { source } = prepareSource({ title: 'Reader', content: text, format: 'markdown', url: '' })
  const currentSource = ref(source),
    busy = ref(false),
    change = vi.fn(),
    select = vi.fn()
  const host = document.createElement('div')
  document.body.append(host)
  app = createApp({
    render: () =>
      h(SourceReader, {
        source: currentSource.value,
        text,
        scope: 'library-one',
        editable: true,
        busy: busy.value,
        onChangeText: change,
        onSelect: select,
      }),
  })
  app.mount(host)
  await nextTick()
  const rendered = host.querySelector<HTMLElement>('.source-markdown-preview')!,
    strong = rendered.querySelectorAll('strong')[1]!,
    node = strong.querySelector('span')!.firstChild!,
    task = rendered.querySelector<HTMLElement>('[data-reading-task]')!,
    selection = document.getSelection()!,
    range = document.createRange()
  task.focus()
  range.setStart(node, 1)
  range.setEnd(node, 4)
  selection.removeAllRanges()
  selection.addRange(range)
  busy.value = true
  await nextTick()
  expect(rendered.querySelectorAll('strong')[1]).toBe(strong)
  expect(rendered.querySelector('[data-reading-task]')).toBe(task)
  expect(document.activeElement).toBe(task)
  expect(selection.anchorNode).toBe(node)
  expect(selection.anchorOffset).toBe(1)
  expect(selection.focusNode).toBe(node)
  expect(selection.focusOffset).toBe(4)
  expect(selection.toString()).toBe('ame')
  expect(task.getAttribute('aria-disabled')).toBe('true')
  task.click()
  expect(change).not.toHaveBeenCalled()
  busy.value = false
  currentSource.value = {
    ...source,
    reading: { offset: 1, fraction: 0, view: 'preview', updatedAt: new Date().toISOString() },
  }
  await nextTick()
  expect(rendered.querySelectorAll('strong')[1]).toBe(strong)
  expect(document.activeElement).toBe(task)
  expect(selection.toString()).toBe('ame')
  expect(task.getAttribute('aria-disabled')).toBe('false')
  rendered.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
  const start = text.lastIndexOf('same') + 1
  expect(select).toHaveBeenLastCalledWith(
    source.id,
    start,
    start + 3,
    expect.objectContaining({ versionId: source.mediaId, quote: 'ame' }),
  )
  task.click()
  expect(change).toHaveBeenCalledOnce()
})

it('reuses unchanged attachment values but releases media on source, version and scope changes', async () => {
  const text = '**same**\n\n![Image](../assets/image.png)',
    { source } = prepareSource({ title: 'Reader', content: text, format: 'markdown', url: '' }),
    currentSource = ref({
      ...source,
      inlineMedia: [
        {
          url: '../assets/image.png',
          path: 'assets/image.png',
          mediaId: 'image',
          hash: 'a'.repeat(64),
        },
      ],
    }),
    scope = ref('library-one'),
    read = vi.fn(async () => new Blob(['image'], { type: 'image/png' })),
    createUrl = vi
      .spyOn(URL, 'createObjectURL')
      .mockImplementation(() => `blob:${read.mock.calls.length}`),
    revokeUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  const host = document.createElement('div')
  document.body.append(host)
  app = createApp({
    render: () =>
      h(SourceReader, { source: currentSource.value, text, scope: scope.value, getMedia: read }),
  })
  app.mount(host)
  await vi.waitFor(() => expect(host.querySelector('img')?.getAttribute('src')).toBe('blob:1'))
  const strong = host.querySelector('strong')!
  currentSource.value = {
    ...currentSource.value,
    inlineMedia: currentSource.value.inlineMedia.map((entry) => ({ ...entry })),
    reading: { offset: 1, fraction: 0, view: 'preview', updatedAt: new Date().toISOString() },
  }
  await nextTick()
  expect(host.querySelector('strong')).toBe(strong)
  expect(read).toHaveBeenCalledOnce()
  expect(revokeUrl).not.toHaveBeenCalled()

  scope.value = 'library-two'
  await vi.waitFor(() => expect(host.querySelector('img')?.getAttribute('src')).toBe('blob:2'))
  expect(revokeUrl).toHaveBeenCalledWith('blob:1')
  currentSource.value = { ...currentSource.value, id: 'another-source' }
  await vi.waitFor(() => expect(host.querySelector('img')?.getAttribute('src')).toBe('blob:3'))
  expect(revokeUrl).toHaveBeenCalledWith('blob:2')
  currentSource.value = { ...currentSource.value, mediaId: 'another-version' }
  await vi.waitFor(() => expect(host.querySelector('img')?.getAttribute('src')).toBe('blob:4'))
  expect(revokeUrl).toHaveBeenCalledWith('blob:3')
  currentSource.value = {
    ...currentSource.value,
    inlineMedia: currentSource.value.inlineMedia.map((entry) => ({
      ...entry,
      mediaId: 'new-image',
    })),
  }
  await vi.waitFor(() => expect(host.querySelector('img')?.getAttribute('src')).toBe('blob:5'))
  expect(read).toHaveBeenLastCalledWith('new-image')
  expect(revokeUrl).toHaveBeenCalledWith('blob:4')
  expect(createUrl).toHaveBeenCalledTimes(5)
})
