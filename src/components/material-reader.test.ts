// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import {
  createApp,
  defineComponent,
  h,
  nextTick,
  shallowReactive,
  shallowRef,
  watch,
  type App,
} from 'vue'
import type { MaterialReaderProps, MaterialSelection } from '@repeaty/plugin-api'
import type { PluginInstallation } from '../plugins/types'
import SourceReader from './SourceReader.vue'
import { prepareSource } from '../core/sources'
import type { Source } from '../core/source-data'

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
      commands: [{ id: 'capture', title: 'Capture', run: async () => {} }],
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

it('keeps navigation command identity through autosaves while repeated restart commands still run', async () => {
  const positions: MaterialReaderProps['position'][] = []
  let report: MaterialReaderProps['onPosition']
  const Reader = defineComponent({
    props: ['position', 'onPosition'],
    setup(props) {
      watch(
        () => props.position,
        (value) => positions.push(value),
        { immediate: true },
      )
      report = (value) => props.onPosition?.(value)
      return () => h('div', { 'data-reader': true })
    },
  })
  context.manager = {
    pluginRuntime: {
      installations: [
        {
          instanceId: 'reader',
          plugin: {
            id: 'test-material',
            type: 'extension',
            kind: 'frontend',
            version: 1,
            label: 'test',
          },
          readers: [{ id: 'reader', title: 'reader', formats: ['study'], component: Reader }],
        } as PluginInstallation,
      ],
    },
  }
  const prepared = prepareSource({
    title: 'Test',
    content: 'same 😊 same',
    format: 'plain',
    url: '',
  })
  const source = shallowRef<Source>({
    ...prepared.source,
    document: {
      schemaVersion: 1 as const,
      providerId: 'test-material',
      readerId: 'reader',
      format: 'study',
      originalMediaId: 'original',
    },
  })
  let reader: InstanceType<typeof SourceReader> | undefined
  const host = document.createElement('div')
  document.body.append(host)
  app = createApp({
    render: () =>
      h(SourceReader, {
        ref: (value) => {
          reader = value as InstanceType<typeof SourceReader>
        },
        source: source.value,
        scope: 'library-one',
        text: 'same 😊 same',
        getMedia: async () => new Blob(['original']),
      }),
  })
  app.mount(host)
  await vi.waitFor(() => expect(reader?.ready).toBe(true))
  await vi.waitFor(() => expect(host.querySelector('[data-reader]')).not.toBeNull())
  const before = positions.length
  const command = positions.at(-1)
  const locator = {
    schemaVersion: 1 as const,
    kind: 'text' as const,
    sourceId: source.value.id,
    versionId: source.value.mediaId,
    start: 8,
    end: 12,
    quote: 'same',
  }
  report?.({ locator, projectionOffset: 8 })
  // Saving the reader's position replaces the source object, but must not replay its old command.
  source.value = {
    ...source.value,
    title: 'Updated metadata',
    reading: { offset: 8, fraction: 0, view: 'source', updatedAt: new Date().toISOString() },
  }
  await nextTick()
  expect(positions).toHaveLength(before)
  expect(positions.at(-1)).toBe(command)
  await reader!.restart()
  await reader!.restart()
  expect(positions).toHaveLength(before + 2)
  expect(positions.slice(-2).map((position) => position?.projectionOffset)).toEqual([0, 0])
  expect(positions.at(-1)).not.toBe(positions.at(-2))
})
