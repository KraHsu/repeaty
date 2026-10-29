// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, shallowReactive, type App } from 'vue'
import type { MaterialReaderProps, MaterialSelection } from '@repeaty/plugin-api'
import type { PluginInstallation } from '../plugins/types'
import SourceReader from './SourceReader.vue'
import { prepareSource } from '../core/sources'

const context = vi.hoisted(() => ({ manager: {} as Record<string, unknown> }))
vi.mock('../plugins/manager', () => ({ usePluginManager: () => context.manager }))
let app: App | undefined
afterEach(() => {
  app?.unmount()
  app = undefined
  document.body.replaceChildren()
})

it('loads original bytes and discards reader callbacks from replaced instances', async () => {
  const callbacks: Pick<MaterialReaderProps, 'onSelect' | 'onPosition'>[] = []
  const Reader = defineComponent({
    props: ['original', 'onSelect', 'onPosition'],
    setup(props) {
      callbacks.push({ onSelect: props.onSelect, onPosition: props.onPosition })
      return () => h('div', { 'data-reader': true }, props.original ? 'original loaded' : 'missing')
    },
  })
  const installation = (instanceId: string) =>
    ({
      instanceId,
      plugin: {
        id: 'test-material',
        type: 'extension',
        kind: 'frontend',
        version: 1,
        label: 'test',
      },
      readers: [{ id: 'reader', title: 'reader', formats: ['study'], component: Reader }],
    }) as PluginInstallation
  const runtime = shallowReactive({ installations: [installation('first')] })
  context.manager = { pluginRuntime: runtime }
  const { source } = prepareSource({
    title: 'Test',
    content: 'same 😊 same',
    format: 'plain',
    url: '',
  })
  source.document = {
    schemaVersion: 1,
    providerId: 'test-material',
    readerId: 'reader',
    format: 'study',
    originalMediaId: 'original',
  }
  const select = vi.fn(),
    position = vi.fn(),
    read = vi.fn(async () => new Blob(['original']))
  const host = document.createElement('div')
  document.body.append(host)
  app = createApp({
    render: () =>
      h(SourceReader, {
        source,
        scope: 'library-one',
        text: 'same 😊 same',
        getMedia: read,
        onSelect: select,
        onPosition: position,
      }),
  })
  app.mount(host)
  await vi.waitFor(() =>
    expect(host.querySelector('[data-reader]')?.textContent).toBe('original loaded'),
  )
  expect(read).toHaveBeenCalledWith('original')
  const selection: MaterialSelection = {
    text: 'same',
    locator: {
      schemaVersion: 1,
      kind: 'text',
      sourceId: source.id,
      versionId: source.mediaId,
      start: 8,
      end: 12,
      quote: 'same',
    },
  }
  callbacks[0]!.onSelect(selection)
  expect(select).toHaveBeenLastCalledWith(source.id, 8, 12, selection.locator)
  runtime.installations = [installation('replacement')]
  await nextTick()
  expect(callbacks).toHaveLength(2)
  select.mockClear()
  position.mockClear()
  callbacks[0]!.onSelect(selection)
  callbacks[0]!.onPosition?.({ locator: selection.locator, projectionOffset: 8 })
  expect(select).not.toHaveBeenCalled()
  expect(position).not.toHaveBeenCalled()
  callbacks[1]!.onSelect({
    ...selection,
    locator: { ...selection.locator, kind: 'text', start: 8, end: 12, quote: 'fake' },
  })
  expect(select).toHaveBeenLastCalledWith(source.id, 0, 0)
  callbacks[1]!.onSelect(selection)
  expect(select).toHaveBeenLastCalledWith(source.id, 8, 12, selection.locator)
  runtime.installations = []
  await nextTick()
  select.mockClear()
  callbacks[1]!.onSelect(selection)
  expect(select).not.toHaveBeenCalled()
  expect(host.querySelector('[data-reader]')).toBeNull()
  expect(host.querySelector('textarea')?.value).toBe('same 😊 same')
})
