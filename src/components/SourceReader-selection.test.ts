// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, ref, type App } from 'vue'
import type { MaterialReaderProps } from '@repeaty/plugin-api'
import type { PluginInstallation } from '../plugins/types'
import SourceReader from './SourceReader.vue'
import { prepareSource } from '../core/sources'

const runtime = vi.hoisted(() => ({ installations: [] as PluginInstallation[] }))
vi.mock('../plugins/manager', () => ({ usePluginManager: () => ({ pluginRuntime: runtime }) }))
let app: App | undefined
afterEach(() => {
  app?.unmount()
  app = undefined
  document.getSelection()?.removeAllRanges()
  document.body.replaceChildren()
  runtime.installations = []
  vi.restoreAllMocks()
})

const toolbar = () => document.querySelector<HTMLElement>('[role="toolbar"]')
async function settle() {
  for (let i = 0; i < 6; i++) await nextTick()
}

it('reopens the same selection after keyboard dismissal and clears it when the library changes', async () => {
  const text = 'A repeated selection',
    { source } = prepareSource({ title: 'Reader', content: text, format: 'markdown', url: '' }),
    scope = ref('library-one'),
    host = document.createElement('div')
  document.body.append(host)
  app = createApp({
    render: () => h(SourceReader, { source, text, scope: scope.value }),
  })
  app.mount(host)
  await settle()
  const preview = host.querySelector<HTMLElement>('.source-markdown-preview')!,
    node = preview.querySelector('p span')!.firstChild!,
    selection = document.getSelection()!,
    range = document.createRange()
  range.setStart(node, 2)
  range.setEnd(node, 10)
  selection.addRange(range)
  preview.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
  await settle()
  expect(toolbar()).not.toBeNull()

  preview.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
  await settle()
  const button = toolbar()!.querySelector('button')!
  expect(document.activeElement).toBe(button)
  button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  preview.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', bubbles: true }))
  await settle()
  expect(toolbar()).toBeNull()
  expect(document.activeElement).toBe(preview)
  expect(selection.toString()).toBe('repeated')

  preview.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
  await settle()
  expect(toolbar()).not.toBeNull()
  scope.value = 'library-two'
  await settle()
  expect(toolbar()).toBeNull()
})

it('releases selection listeners and a pending position frame when the reader unmounts', async () => {
  const addWindow = vi.spyOn(window, 'addEventListener'),
    removeWindow = vi.spyOn(window, 'removeEventListener'),
    addDocument = vi.spyOn(document, 'addEventListener'),
    removeDocument = vi.spyOn(document, 'removeEventListener'),
    text = 'Keyboard selection',
    { source } = prepareSource({ title: 'Reader', content: text, format: 'plain', url: '' }),
    host = document.createElement('div')
  document.body.append(host)
  app = createApp({ render: () => h(SourceReader, { source, text, scope: 'library-one' }) })
  app.mount(host)
  await settle()
  const area = host.querySelector('textarea')!
  area.focus()
  area.setSelectionRange(0, 8)
  area.dispatchEvent(new Event('select', { bubbles: true }))
  await settle()
  expect(toolbar()).not.toBeNull()
  const resize = addWindow.mock.calls.filter(([event]) => event === 'resize'),
    scroll = addDocument.mock.calls.filter(([event]) => event === 'scroll')
  expect(resize.length).toBeGreaterThan(0)
  expect(scroll.length).toBeGreaterThan(0)
  window.dispatchEvent(new Event('resize'))
  app.unmount()
  app = undefined
  await settle()
  expect(toolbar()).toBeNull()
  for (const call of resize) expect(removeWindow.mock.calls).toContainEqual(call)
  for (const call of scroll) expect(removeDocument.mock.calls).toContainEqual(call)
  expect(document.querySelector('[aria-hidden="true"][style*="visibility: hidden"]')).toBeNull()
})

it('retires plugin reader callbacks and their toolbar on a library switch', async () => {
  const callbacks: MaterialReaderProps['onSelect'][] = [],
    text = 'Canvas selection',
    { source } = prepareSource({ title: 'Reader', content: text, format: 'plain', url: '' }),
    scope = ref('library-one'),
    host = document.createElement('div')
  const Reader = defineComponent({
    props: ['onSelect'],
    setup(props) {
      callbacks.push(props.onSelect)
      return () => h('div', { tabindex: 0 }, 'Canvas reader')
    },
  })
  source.document = {
    schemaVersion: 1,
    providerId: 'canvas-test',
    readerId: 'canvas',
    format: 'study',
    originalMediaId: 'original',
  }
  runtime.installations = [
    {
      instanceId: 'reader-instance',
      plugin: {
        id: 'canvas-test',
        type: 'extension',
        kind: 'frontend',
        label: 'Canvas',
        version: 1,
      },
      readers: [{ id: 'canvas', title: 'Canvas', formats: ['study'], component: Reader }],
    } as PluginInstallation,
  ]
  document.body.append(host)
  app = createApp({
    render: () =>
      h(SourceReader, {
        source,
        text,
        scope: scope.value,
        getMedia: async () => new Blob(['canvas']),
      }),
  })
  app.mount(host)
  await settle()
  const selection = {
    text,
    locator: {
      schemaVersion: 1 as const,
      kind: 'text' as const,
      sourceId: source.id,
      versionId: source.mediaId,
      start: 0,
      end: text.length,
      quote: text,
    },
  }
  callbacks[0]!(selection)
  await settle()
  expect(toolbar()).not.toBeNull()
  scope.value = 'library-two'
  await settle()
  expect(callbacks).toHaveLength(2)
  expect(toolbar()).toBeNull()
  callbacks[0]!(selection)
  await settle()
  expect(toolbar()).toBeNull()
  callbacks[1]!(selection)
  await settle()
  expect(toolbar()).not.toBeNull()
})
