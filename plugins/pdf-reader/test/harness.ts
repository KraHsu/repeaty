import * as Vue from 'vue'
import type {
  MaterialImportCandidate,
  MaterialReaderProps,
  MaterialSelection,
  MaterialReadingPosition,
} from '@repeaty/plugin-api'

const { defineComponent, h, createApp, ref } = Vue
const active = { workers: 0, urls: 0, scopes: 0 }
const storedViews = { reads: 0, writes: 0, values: {} as Record<string, unknown> }
const all = new Set<ReturnType<typeof createScope>>()
let assets: Record<string, { type: string; base64: string }> = {}
let cancelNextWorker = false
function read(path: string) {
  const value = assets[path]
  if (!value) return
  return new Blob([Uint8Array.from(atob(value.base64), (char) => char.charCodeAt(0))], {
    type: value.type,
  })
}
function createScope() {
  const controller = new AbortController(),
    callbacks: (() => void)[] = []
  active.scopes++
  const scope = {
    signal: controller.signal,
    onCleanup: (callback: () => void) => callbacks.push(callback),
    createWorker(source: string, options?: WorkerOptions) {
      const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }))
      active.urls++
      const worker = new Worker(url, options)
      active.workers++
      const terminate = worker.terminate.bind(worker)
      let terminated = false
      worker.terminate = () => {
        if (!terminated) {
          terminated = true
          active.workers--
          terminate()
        }
      }
      callbacks.push(() => {
        worker.terminate()
        URL.revokeObjectURL(url)
        active.urls--
      })
      if (cancelNextWorker) {
        cancelNextWorker = false
        queueMicrotask(() => scope.dispose())
      }
      return worker
    },
    dispose() {
      if (controller.signal.aborted) return
      controller.abort()
      callbacks.reverse().forEach((callback) => callback())
      active.scopes--
      all.delete(scope)
    },
  }
  all.add(scope)
  return scope
}
let importer: { parse: (file: File, context: unknown) => Promise<MaterialImportCandidate[]> }
let reader: { component: Vue.Component }
const UiButton = defineComponent({
  props: ['disabled', 'type', 'variant'],
  setup:
    (props, { slots, attrs }) =>
    () =>
      h(
        'button',
        { ...attrs, type: props.type ?? 'button', disabled: props.disabled },
        slots.default?.(),
      ),
})
const UiInput = defineComponent({
  props: ['modelValue'],
  emits: ['update:modelValue'],
  setup:
    (props, { attrs, emit }) =>
    () =>
      h('input', {
        ...attrs,
        value: props.modelValue,
        onInput: (event: Event) =>
          emit('update:modelValue', (event.target as HTMLInputElement).value),
      }),
})
const UiSelect = defineComponent({
  props: ['modelValue', 'items'],
  emits: ['update:modelValue'],
  setup:
    (props, { attrs, emit }) =>
    () =>
      h(
        'select',
        {
          ...attrs,
          value: props.modelValue,
          onChange: (event: Event) =>
            emit('update:modelValue', (event.target as HTMLSelectElement).value),
        },
        props.items.map((item: { value: string; label: string }) =>
          h('option', { value: item.value }, item.label),
        ),
      ),
})
const UiNotice = defineComponent({
  setup:
    (_, { slots }) =>
    () =>
      h('aside', slots.default?.()),
})
const sdk = {
  registerImporter: (value: typeof importer) => {
    importer = value
  },
  registerReader: (value: typeof reader) => {
    reader = value
  },
  resources: { read, createScope },
  materials: { list: async () => records },
  pluginData: {
    async get(id: string, scope: string) {
      storedViews.reads++
      return storedViews.values[scope + ':' + id]
    },
    async set(id: string, value: unknown, scope: string) {
      storedViews.writes++
      storedViews.values[scope + ':' + id] = structuredClone(value)
    },
  },
  UiButton,
  UiInput,
  UiSelect,
  UiNotice,
}
Object.assign(globalThis, { __REPEATY_PLUGIN_HOST__: { current: sdk, vue: Vue } })
const bundle = await fetch('/dist/pdf-reader.repeaty-plugin').then((response) => response.json())
assets = bundle.assets
const style = document.createElement('style')
style.textContent = bundle.styles
document.head.append(style)
const moduleUrl = URL.createObjectURL(new Blob([bundle.main], { type: 'text/javascript' }))
const module = await import(/* @vite-ignore */ moduleUrl)
module.default()
URL.revokeObjectURL(moduleUrl)
let app: Vue.App | undefined, currentProps: Vue.Ref<MaterialReaderProps> | undefined
let records: MaterialReaderProps['material'][] = []
const state: {
  selection?: MaterialSelection
  position?: MaterialReadingPosition
  candidates: MaterialImportCandidate[]
  opened?: string
} = { candidates: [] }
Object.assign(window, {
  pdfTest: {
    active,
    state,
    storedViews,
    async parse(filename: string, cancel: boolean | 'during' = false) {
      const blob = await fetch('/test/fixtures/' + filename).then((response) => response.blob())
      const file = new File([blob], filename, { type: 'application/pdf' })
      const lifetime = createScope()
      if (cancel === true) lifetime.dispose()
      cancelNextWorker = cancel === 'during'
      try {
        const candidates = await importer.parse(file, {
          ...lifetime,
          progress() {},
          async yield() {
            await new Promise((resolve) => setTimeout(resolve, 0))
          },
        })
        state.candidates = candidates
        return candidates
      } finally {
        lifetime.dispose()
      }
    },
    async mount(
      filename: string,
      index = 0,
      selection?: MaterialSelection,
      position?: MaterialReaderProps['position'],
      options: { readOnly?: boolean; version?: string; originalMediaId?: string } = {},
    ) {
      app?.unmount()
      const blob = await fetch('/test/fixtures/' + filename).then((response) => response.blob())
      records = state.candidates.map((candidate, index) => ({
        id: 'source-' + index,
        versionId: options.version ?? 'version-' + index,
        title: candidate.title,
        format: candidate.format,
        locked: false,
        parentSourceId: candidate.parentKey ? 'source-0' : undefined,
        document: {
          schemaVersion: 1,
          format: 'pdf',
          providerId: 'pdf-reader',
          readerId: 'pdf',
          originalMediaId: options.originalMediaId ?? 'original',
          data: candidate.documentData,
          container: candidate.container,
        },
      }))
      const candidate = state.candidates[index]!
      currentProps = ref({
        workspaceScope: options.readOnly ? 'readonly-source-context' : 'test-library',
        readOnly: options.readOnly,
        material: records[index]!,
        text: candidate.text,
        original: blob,
        selection,
        position,
        onOpen(id: string) {
          state.opened = id
        },
        onSelect(selected: MaterialSelection | undefined) {
          state.selection = selected
          if (currentProps) currentProps.value.selection = selected
        },
        onPosition(value: MaterialReadingPosition) {
          state.position = value
        },
      })
      app = createApp(
        defineComponent({ setup: () => () => h(reader.component, currentProps!.value) }),
      )
      app.mount('#app')
    },
    select(value?: MaterialSelection) {
      if (currentProps) currentProps.value.selection = value
    },
    position(value?: MaterialReaderProps['position']) {
      if (currentProps) currentProps.value.position = value
    },
    async updateMetadata() {
      if (currentProps)
        currentProps.value.material = { ...currentProps.value.material, title: 'Updated metadata' }
      await Vue.nextTick()
    },
    unmount() {
      app?.unmount()
      app = undefined
    },
    unload() {
      all.forEach((scope) => scope.dispose())
    },
  },
})
