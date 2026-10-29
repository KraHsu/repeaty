// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, ref, type App } from 'vue'
import SourcePanel from './SourcePanel.vue'
import { addSource, prepareSource } from '../core/sources'
import { fixture, now } from '../core/test-fixtures'
import type { ReadingProgress } from '../composables/useReadingProgress'
import type { MaterialWorkbenchActions } from './material-workbench-actions'

const annotation = vi.hoisted(() => ({ canLeave: true }))
vi.mock('../composables/material-knowledge', () => ({
  createMaterialKnowledge: () => ({ dispose: vi.fn() }),
}))
vi.mock('./MaterialSearch.vue', () => ({ default: { template: '<div />' } }))
vi.mock('./MaterialImport.vue', () => ({ default: { template: '<div />' } }))
vi.mock('./SourceLinks.vue', () => ({ default: { template: '<div />' } }))
vi.mock('./SourceMetadata.vue', () => ({ default: { template: '<div />' } }))
vi.mock('./SourceAnnotations.vue', async () => {
  const { defineComponent, h } = await import('vue')
  return {
    default: defineComponent({
      setup(_, { expose }) {
        expose({
          flush: async () => annotation.canLeave,
          get dirty() {
            return !annotation.canLeave
          },
        })
        return () => h('div')
      },
    }),
  }
})
vi.mock('./SourceReader.vue', async () => {
  const { defineComponent, h } = await import('vue')
  return {
    default: defineComponent({
      props: ['source', 'scope', 'text'],
      setup(props, { expose }) {
        expose({
          ready: true,
          capture: () => ({
            sourceId: props.source.id,
            mediaId: props.source.mediaId,
            scope: props.scope,
            position: { offset: 0, fraction: 0, updatedAt: now.toISOString() },
          }),
        })
        return () => h('div', { 'data-testid': 'reader' }, props.text)
      },
    }),
  }
})
vi.mock('../plugins/manager', () => ({
  usePluginManager: () => ({ pluginRuntime: { installations: [] } }),
}))
vi.mock('./ui', async () => {
  const { defineComponent, h } = await import('vue')
  const passthrough = defineComponent({
    setup(_, { attrs, slots }) {
      return () => h('div', attrs, slots.default?.())
    },
  })
  const field = defineComponent({
    props: ['modelValue'],
    emits: ['update:modelValue'],
    setup(props, { attrs, emit }) {
      return () =>
        h('input', {
          ...attrs,
          value: props.modelValue,
          onInput: (e: Event) => emit('update:modelValue', (e.target as HTMLInputElement).value),
        })
    },
  })
  return {
    UiButton: defineComponent({
      setup(_, { attrs, slots }) {
        return () => h('button', attrs, slots.default?.())
      },
    }),
    UiInput: field,
    UiSelect: field,
    UiTextarea: field,
    UiCheckbox: field,
    UiCollapsible: passthrough,
  }
})

let app: App | undefined
afterEach(() => {
  app?.unmount()
  app = undefined
  document.body.replaceChildren()
  annotation.canLeave = true
})
async function settle() {
  for (let i = 0; i < 7; i++) {
    await Promise.resolve()
    await nextTick()
  }
}
it('drops late old-scope text and prevents leaving a reader with unsaved annotations', async () => {
  const prepared = prepareSource(
    { title: 'Material', url: '', format: 'markdown', content: 'Original' },
    now,
  )
  const library = addSource(fixture(), prepared.source, prepared.asset),
    scope = ref('local:first'),
    panel = ref<InstanceType<typeof SourcePanel>>()
  let finish!: (text: string) => void
  const read = vi.fn(() =>
    scope.value === 'local:first'
      ? new Promise<string>((resolve) => {
          finish = resolve
        })
      : Promise.resolve('Current library text'),
  )
  const saveReading = vi.fn(async () => true)
  const reading = {
    pending: new Map(),
    errors: new Map(),
    hold: () => () => {},
    record: vi.fn(),
    acknowledge: vi.fn(),
    flush: vi.fn(async () => true),
  } as unknown as ReadingProgress
  const actions = {
    prepareEditor: vi.fn(),
    writeDraft: vi.fn(),
    discardDraft: vi.fn(),
    editContent: vi.fn(),
    annotate: vi.fn(),
    removeAnnotation: vi.fn(),
    createFolder: vi.fn(),
    renameFolder: vi.fn(),
    removeFolder: vi.fn(),
    move: vi.fn(),
  } as MaterialWorkbenchActions
  const host = document.createElement('div')
  document.body.append(host)
  app = createApp({
    render: () =>
      h(SourcePanel, {
        library,
        scope: scope.value,
        busy: false,
        reading,
        now,
        session: { sourceId: prepared.source.id, mediaId: prepared.source.mediaId },
        canUndoReading: false,
        arrangeBatch: async () => true,
        undoReading: async () => true,
        read,
        save: async () => true,
        updateDetails: async () => true,
        saveExcerpt: async () => true,
        remove: async () => true,
        arrange: async () => true,
        saveReading,
        workbench: actions,
        ref: panel,
      }),
  })
  app.mount(host)
  await settle()
  scope.value = 'local:second'
  await settle()
  expect(host.querySelector('[data-testid="reader"]')?.textContent).toBe('Current library text')
  finish('Stale library text')
  await settle()
  expect(host.querySelector('[data-testid="reader"]')?.textContent).toBe('Current library text')
  annotation.canLeave = false
  expect(await panel.value!.leaveSession()).toBe(false)
  expect(saveReading).not.toHaveBeenCalled()
  annotation.canLeave = true
  expect(await panel.value!.leaveSession()).toBe(true)
  expect(saveReading).toHaveBeenCalledOnce()
})

it.each([
  [undefined, true],
  ['markdown', true],
  ['md', true],
  ['plain', true],
  ['text', true],
  ['txt', true],
  ['pdf', false],
  ['epub', false],
  ['study-json', false],
] as const)('offers body editing for text format %s only: %s', async (format, editable) => {
  const prepared = prepareSource(
    { title: 'Material', url: '', format: 'markdown', content: 'Original' },
    now,
  )
  if (format)
    prepared.source.document = {
      schemaVersion: 1,
      providerId: 'test-importer',
      format,
      originalMediaId: prepared.source.mediaId,
    }
  const library = addSource(fixture(), prepared.source, prepared.asset)
  const reading = {
    pending: new Map(),
    errors: new Map(),
    hold: () => () => {},
    record: vi.fn(),
    acknowledge: vi.fn(),
    flush: vi.fn(async () => true),
  } as unknown as ReadingProgress
  const actions = {
    prepareEditor: vi.fn(),
    writeDraft: vi.fn(),
    discardDraft: vi.fn(),
    editContent: vi.fn(),
    annotate: vi.fn(),
    removeAnnotation: vi.fn(),
    createFolder: vi.fn(),
    renameFolder: vi.fn(),
    removeFolder: vi.fn(),
    move: vi.fn(),
  } as MaterialWorkbenchActions
  const host = document.createElement('div')
  document.body.append(host)
  app = createApp({
    render: () =>
      h(SourcePanel, {
        library,
        scope: `local:text-format-${format ?? 'builtin'}`,
        busy: false,
        reading,
        now,
        canUndoReading: false,
        arrangeBatch: async () => true,
        undoReading: async () => true,
        read: async () => 'Original',
        save: async () => true,
        updateDetails: async () => true,
        saveExcerpt: async () => true,
        remove: async () => true,
        arrange: async () => true,
        saveReading: async () => true,
        workbench: actions,
      }),
  })
  app.mount(host)
  await settle()
  expect(host.querySelector('[data-testid="reader"]')).not.toBeNull()
  expect(
    [...host.querySelectorAll('button')].some((button) => button.textContent?.includes('编辑正文')),
  ).toBe(editable)
})
