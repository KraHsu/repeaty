// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, ref, type App } from 'vue'
import SourceContentEditor from './SourceContentEditor.vue'
import SourceAnnotations from './SourceAnnotations.vue'
import MaterialTree from './MaterialTree.vue'
import { prepareSource, addSource } from '../core/sources'
import { fixture } from '../core/test-fixtures'
import type { MaterialWorkbenchActions } from './material-workbench-actions'
import type { SourceDraft } from '../core/source-workbench'

vi.mock('./ui', async () => {
  const { defineComponent, h, ref } = await import('vue')
  const field = (tag: string) =>
    defineComponent({
      inheritAttrs: false,
      props: ['modelValue'],
      emits: ['update:modelValue'],
      setup(props, { attrs, emit, expose }) {
        const input = ref<HTMLElement>()
        expose({ textareaRef: input })
        return () =>
          h(tag, {
            ...attrs,
            ref: input,
            value: props.modelValue,
            onInput: (event: Event) =>
              emit('update:modelValue', (event.target as HTMLInputElement).value),
          })
      },
    })
  return {
    UiInput: field('input'),
    UiTextarea: field('textarea'),
    UiSelect: field('select'),
    UiButton: defineComponent({
      setup(_, { attrs, slots }) {
        return () => h('button', attrs, slots.default?.())
      },
    }),
    UiCollapsible: defineComponent({
      setup(_, { slots }) {
        return () => h('div', [slots.default?.(), slots.content?.()])
      },
    }),
  }
})
vi.mock('./AppModal.vue', () => ({
  default: { template: '<section role="dialog"><slot /></section>' },
}))
vi.mock('./SourceContext.vue', () => ({ default: { template: '<div />' } }))
vi.mock('../settings-store', () => ({ readSetting: () => null, writeSetting: vi.fn() }))

let app: App | undefined
afterEach(() => {
  app?.unmount()
  app = undefined
  document.body.replaceChildren()
  vi.restoreAllMocks()
  vi.useRealTimers()
})
async function settle() {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve()
    await nextTick()
  }
}
function input(value: string, label?: string) {
  const field = document.querySelector<HTMLTextAreaElement>(
    label ? `textarea[aria-label="${label}"]` : 'textarea',
  )!
  field.value = value
  field.dispatchEvent(new Event('input', { bubbles: true }))
}
function click(text: string) {
  const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (button) => button.textContent?.trim() === text,
  )
  expect(button).toBeDefined()
  button!.click()
}
function mount(render: () => ReturnType<typeof h>) {
  const host = document.createElement('div')
  document.body.append(host)
  app = createApp({ render })
  app.mount(host)
  return host
}
function unloading() {
  const event = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(event)
  return event.defaultPrevented
}
const prepared = () =>
  prepareSource({ title: 'Material', url: '', format: 'markdown', content: 'Original' })
function actions(): MaterialWorkbenchActions {
  return {
    prepareEditor: vi.fn(async () => ({ properties: '' })),
    writeDraft: vi.fn(async () => {}),
    discardDraft: vi.fn(async () => {}),
    editContent: vi.fn(async () => true),
    annotate: vi.fn(async () => true),
    removeAnnotation: vi.fn(async () => true),
    createFolder: vi.fn(async () => true),
    renameFolder: vi.fn(async () => true),
    removeFolder: vi.fn(async () => true),
    move: vi.fn(async () => true),
  }
}

it('coalesces draft input, flushes the latest text and keeps a failed content save recoverable', async () => {
  vi.useFakeTimers()
  const { source } = prepared(),
    methods = actions(),
    editor = ref<InstanceType<typeof SourceContentEditor>>()
  let finish!: () => void
  const drafts: SourceDraft[] = []
  const write = vi.fn(async (draft: SourceDraft) => {
    drafts.push(draft)
    if (drafts.length === 1)
      await new Promise<void>((resolve) => {
        finish = resolve
      })
  })
  const save = vi.fn(async () => false),
    closed = vi.fn()
  mount(() =>
    h(SourceContentEditor, {
      source,
      text: 'Original',
      scope: 'local:one',
      prepare: methods.prepareEditor,
      writeDraft: write,
      discardDraft: methods.discardDraft,
      save,
      ref: editor,
      onClose: closed,
    }),
  )
  await settle()
  input('First edit', '材料正文')
  await settle()
  input('Second edit', '材料正文')
  await settle()
  expect(write).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(300)
  expect(drafts.map((draft) => draft.content)).toEqual(['Second edit'])
  input('Intermediate edit', '材料正文')
  input('Final edit', '材料正文')
  await vi.advanceTimersByTimeAsync(300)
  expect(write).toHaveBeenCalledTimes(1)
  const flushed = editor.value!.flush()
  finish()
  expect(await flushed).toBe(true)
  expect(drafts.map((draft) => draft.content)).toEqual(['Second edit', 'Final edit'])
  expect(drafts[0]!.id).toBe(drafts[1]!.id)
  click('保存为新版本')
  await settle()
  expect(save).toHaveBeenCalledWith(
    expect.objectContaining({ content: 'Final edit', draftId: drafts[1]!.id, scope: 'local:one' }),
  )
  expect(closed).not.toHaveBeenCalled()
  click('保留草稿并返回')
  await settle()
  expect(closed).toHaveBeenCalledOnce()
  expect(methods.discardDraft).not.toHaveBeenCalled()
})

it('flushes without waiting for debounce, persists undo to the original text and blocks leaving on write failure', async () => {
  vi.useFakeTimers()
  const { source } = prepared(),
    methods = actions(),
    editor = ref<InstanceType<typeof SourceContentEditor>>(),
    closed = vi.fn()
  const write = vi.fn(async (_draft: SourceDraft) => {})
  mount(() =>
    h(SourceContentEditor, {
      source,
      text: 'Original',
      scope: 'local:one',
      prepare: methods.prepareEditor,
      writeDraft: write,
      discardDraft: methods.discardDraft,
      save: methods.editContent,
      ref: editor,
      onClose: closed,
    }),
  )
  await settle()
  input('Changed', '材料正文')
  expect(await editor.value!.flush()).toBe(true)
  expect(write).toHaveBeenLastCalledWith(expect.objectContaining({ content: 'Changed' }))
  input('Original', '材料正文')
  expect(await editor.value!.flush()).toBe(true)
  expect(write).toHaveBeenLastCalledWith(expect.objectContaining({ content: 'Original' }))
  write.mockRejectedValue(new Error('disk offline'))
  input('Unsaved', '材料正文')
  click('保留草稿并返回')
  await settle()
  expect(closed).not.toHaveBeenCalled()
  expect(document.body.textContent).toContain('disk offline')
  write.mockResolvedValue(undefined)
  click('保留草稿并返回')
  await settle()
  expect(closed).toHaveBeenCalledOnce()
  expect(write).toHaveBeenLastCalledWith(expect.objectContaining({ content: 'Unsaved' }))
})

it('guards refresh only until the latest body draft is durable, including failure and reverting text', async () => {
  vi.useFakeTimers()
  const { source } = prepared(),
    methods = actions(),
    editor = ref<InstanceType<typeof SourceContentEditor>>()
  let finish!: () => void
  const write = vi.fn(async () => {
    await new Promise<void>((resolve) => {
      finish = resolve
    })
  })
  mount(() =>
    h(SourceContentEditor, {
      source,
      text: 'Original',
      scope: 'local:one',
      prepare: methods.prepareEditor,
      writeDraft: write,
      discardDraft: methods.discardDraft,
      save: methods.editContent,
      ref: editor,
    }),
  )
  await settle()
  expect(unloading()).toBe(false)
  input('Edited', '材料正文')
  expect(unloading()).toBe(true)
  expect(write).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(300)
  expect(unloading()).toBe(true)
  finish()
  await settle()
  expect(unloading()).toBe(false)
  expect(editor.value!.dirty).toBe(true)

  write.mockRejectedValue(new Error('draft failed'))
  input('Original', '材料正文')
  await vi.advanceTimersByTimeAsync(300)
  expect(editor.value!.dirty).toBe(false)
  expect(unloading()).toBe(true)
  expect(await editor.value!.flush()).toBe(false)
  write.mockResolvedValue(undefined)
  expect(await editor.value!.flush()).toBe(true)
  expect(unloading()).toBe(false)
  input('Another pending edit', '材料正文')
  expect(unloading()).toBe(true)
  app!.unmount()
  app = undefined
  expect(unloading()).toBe(false)
})

it('does not block refresh for a restored durable body draft', async () => {
  const { source } = prepared(),
    methods = actions()
  methods.prepareEditor = vi.fn(async () => ({
    properties: '',
    draft: {
      id: crypto.randomUUID(),
      sourceId: source.id,
      mediaId: source.mediaId,
      scope: 'local:one',
      content: 'Restored draft',
      title: source.title,
      url: '',
      properties: '',
      updatedAt: new Date().toISOString(),
    },
  }))
  mount(() =>
    h(SourceContentEditor, {
      source,
      text: 'Original',
      scope: 'local:one',
      prepare: methods.prepareEditor,
      writeDraft: methods.writeDraft,
      discardDraft: methods.discardDraft,
      save: methods.editContent,
    }),
  )
  await settle()
  expect(unloading()).toBe(false)
  expect(methods.writeDraft).not.toHaveBeenCalled()
})

it('cancels a staged autosave when its library scope is replaced', async () => {
  vi.useFakeTimers()
  const { source } = prepared(),
    methods = actions(),
    scope = ref('local:one')
  mount(() =>
    h(SourceContentEditor, {
      source,
      text: 'Original',
      scope: scope.value,
      prepare: methods.prepareEditor,
      writeDraft: methods.writeDraft,
      discardDraft: methods.discardDraft,
      save: methods.editContent,
    }),
  )
  await settle()
  input('Old library edit', '材料正文')
  scope.value = 'local:two'
  await settle()
  await vi.advanceTimersByTimeAsync(300)
  expect(methods.writeDraft).not.toHaveBeenCalled()
  expect(
    document.querySelector<HTMLTextAreaElement>('textarea[aria-label="材料正文"]')!.readOnly,
  ).toBe(true)
})

it('keeps pending text but refuses to overwrite metadata changed while the editor was open', async () => {
  vi.useFakeTimers()
  const source = ref(prepared().source),
    methods = actions(),
    closed = vi.fn()
  mount(() =>
    h(SourceContentEditor, {
      source: source.value,
      text: 'Original',
      scope: 'local:one',
      prepare: methods.prepareEditor,
      writeDraft: methods.writeDraft,
      discardDraft: methods.discardDraft,
      save: methods.editContent,
      onClose: closed,
    }),
  )
  await settle()
  input('Pending body', '材料正文')
  source.value = { ...source.value, title: 'Renamed elsewhere' }
  await settle()
  const save = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (button) => button.textContent?.trim() === '保存为新版本',
  )!
  expect(save.disabled).toBe(true)
  expect(document.body.textContent).toContain('材料信息已变化')
  click('保留草稿并返回')
  await settle()
  expect(methods.writeDraft).toHaveBeenCalledWith(
    expect.objectContaining({ content: 'Pending body', baseTitle: 'Material' }),
  )
  expect(methods.editContent).not.toHaveBeenCalled()
  expect(closed).toHaveBeenCalledOnce()
})

it('restores a draft with old metadata as a conflict instead of silently overwriting a renamed source', async () => {
  const source = { ...prepared().source, title: 'New title' },
    methods = actions()
  methods.prepareEditor = vi.fn(async () => ({
    properties: '',
    draft: {
      id: crypto.randomUUID(),
      sourceId: source.id,
      mediaId: source.mediaId,
      scope: 'local:one',
      title: 'Material',
      baseTitle: 'Material',
      url: '',
      baseUrl: '',
      content: 'Saved draft text',
      properties: '',
      updatedAt: new Date().toISOString(),
    },
  }))
  mount(() =>
    h(SourceContentEditor, {
      source,
      text: 'Original',
      scope: 'local:one',
      prepare: methods.prepareEditor,
      writeDraft: methods.writeDraft,
      discardDraft: methods.discardDraft,
      save: methods.editContent,
    }),
  )
  await settle()
  expect(
    document.querySelector<HTMLTextAreaElement>('textarea[aria-label="材料正文"]')!.value,
  ).toBe('Saved draft text')
  expect(
    document.querySelector<HTMLTextAreaElement>('textarea[aria-label="材料正文"]')!.readOnly,
  ).toBe(true)
  expect(document.body.textContent).toContain('草稿对应的正文或材料信息已变化')
  expect(methods.editContent).not.toHaveBeenCalled()
})

it('does not enable edits after initialization failure or delete the unread draft when leaving', async () => {
  const { source } = prepared(),
    methods = actions(),
    closed = vi.fn()
  methods.prepareEditor = vi.fn(async () => {
    throw new Error('disk offline')
  })
  mount(() =>
    h(SourceContentEditor, {
      source,
      text: 'Original',
      scope: 'local:one',
      prepare: methods.prepareEditor,
      writeDraft: methods.writeDraft,
      discardDraft: methods.discardDraft,
      save: methods.editContent,
      onClose: closed,
    }),
  )
  await settle()
  expect(
    document.querySelector<HTMLTextAreaElement>('textarea[aria-label="材料正文"]')!.readOnly,
  ).toBe(true)
  expect(document.body.textContent).toContain('disk offline')
  click('保留草稿并返回')
  await settle()
  expect(closed).toHaveBeenCalledOnce()
  expect(methods.discardDraft).not.toHaveBeenCalled()
})

it('guards unsaved annotations and ignores a late save after switching libraries', async () => {
  const source = ref(prepared().source),
    scope = ref('local:one'),
    methods = actions(),
    panel = ref<InstanceType<typeof SourceAnnotations>>()
  let finish!: (value: boolean) => void
  methods.annotate = vi.fn(
    () =>
      new Promise<boolean>((resolve) => {
        finish = resolve
      }),
  )
  mount(() =>
    h(SourceAnnotations, {
      source: source.value,
      scope: scope.value,
      busy: false,
      actions: methods,
      read: async () => 'Original',
      ref: panel,
    }),
  )
  const add = () =>
    panel.value!.add({
      sourceId: source.value.id,
      mediaId: source.value.mediaId,
      start: 0,
      end: 8,
      quote: 'Original',
    })
  add()
  await settle()
  input('First library annotation', '批注内容')
  await settle()
  expect(await panel.value!.flush()).toBe(false)
  click('保存批注')
  await settle()
  expect(methods.annotate).toHaveBeenCalledWith(
    expect.objectContaining({ scope: 'local:one', body: 'First library annotation' }),
  )
  scope.value = 'local:two'
  source.value = prepared().source
  await settle()
  add()
  await settle()
  input('Second library annotation', '批注内容')
  await settle()
  finish(true)
  await settle()
  expect(
    document.querySelector<HTMLTextAreaElement>('textarea[aria-label="批注内容"]')!.value,
  ).toBe('Second library annotation')
  expect(await panel.value!.flush()).toBe(false)
})

it('guards window close for an unsaved or saving annotation and releases it after save or discard', async () => {
  const { source } = prepared(),
    methods = actions(),
    panel = ref<InstanceType<typeof SourceAnnotations>>()
  let finish!: (value: boolean) => void
  methods.annotate = vi.fn(
    () =>
      new Promise<boolean>((resolve) => {
        finish = resolve
      }),
  )
  mount(() =>
    h(SourceAnnotations, {
      source,
      scope: 'local:one',
      busy: false,
      actions: methods,
      read: async () => 'Original',
      ref: panel,
    }),
  )
  const add = () =>
    panel.value!.add({
      sourceId: source.id,
      mediaId: source.mediaId,
      start: 0,
      end: 8,
      quote: 'Original',
    })
  add()
  await settle()
  expect(unloading()).toBe(false)
  input('Unsaved annotation', '批注内容')
  await settle()
  expect(unloading()).toBe(true)
  click('保存批注')
  await settle()
  expect(unloading()).toBe(true)
  finish(false)
  await settle()
  expect(unloading()).toBe(true)
  click('保存批注')
  await settle()
  finish(true)
  await settle()
  expect(unloading()).toBe(false)
  add()
  await settle()
  input('Discard this annotation', '批注内容')
  expect(await panel.value!.flush()).toBe(false)
  click('放弃更改')
  await settle()
  expect(unloading()).toBe(false)
  add()
  await settle()
  input('Pending at unmount', '批注内容')
  app!.unmount()
  app = undefined
  expect(unloading()).toBe(false)
})

it('clears folder and drag state on a library change and ignores a late completion', async () => {
  const { source, asset } = prepared(),
    library = addSource(fixture(), source, asset),
    scope = ref('local:one'),
    methods = actions()
  let finish!: (value: boolean) => void
  methods.createFolder = vi.fn(
    () =>
      new Promise<boolean>((resolve) => {
        finish = resolve
      }),
  )
  mount(() =>
    h(MaterialTree, {
      library,
      scope: scope.value,
      selectedId: source.id,
      busy: false,
      actions: methods,
    }),
  )
  click('新建文件夹')
  await settle()
  const name = document.querySelector<HTMLInputElement>('input')!
  name.value = 'Old library folder'
  name.dispatchEvent(new Event('input', { bubbles: true }))
  await settle()
  document
    .querySelector('form')!
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  await settle()
  const row = document.querySelector('li')!
  row.dispatchEvent(new Event('dragstart', { bubbles: true }))
  scope.value = 'local:two'
  await settle()
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  click('新建文件夹')
  await settle()
  finish(true)
  await settle()
  expect(document.querySelector('[role="dialog"]')).not.toBeNull()
  document
    .querySelector('.material-tree')!
    .dispatchEvent(new Event('drop', { bubbles: true, cancelable: true }))
  await settle()
  expect(methods.move).not.toHaveBeenCalled()
})

it('keeps only one tree menu open and closes it before a folder or move action', async () => {
  const { source, asset } = prepared(),
    library = addSource(fixture(), source, asset),
    methods = actions()
  library.materialFolders = [
    { id: 'folder', name: 'Folder', order: 0, createdAt: new Date().toISOString() },
  ]
  mount(() =>
    h(MaterialTree, {
      library,
      scope: 'local:one',
      selectedId: source.id,
      busy: false,
      actions: methods,
    }),
  )
  const menus = [...document.querySelectorAll<HTMLDetailsElement>('.tree-menu')]
  menus[0]!.querySelector('summary')!.click()
  await settle()
  expect(document.querySelectorAll('.tree-menu[open]')).toHaveLength(1)
  menus[1]!.querySelector('summary')!.click()
  await settle()
  expect(document.querySelectorAll('.tree-menu[open]')).toHaveLength(1)
  expect(menus[0]!.open).toBe(false)
  const move = [...menus[1]!.querySelectorAll('button')].find(
    (button) => button.textContent?.trim() === '移动',
  )!
  move.click()
  await settle()
  expect(document.querySelectorAll('.tree-menu[open]')).toHaveLength(0)
  expect(document.querySelector('[role="dialog"]')).not.toBeNull()
})

it('bounds a large outline to 200 initial rows and clamps pagination after collapsing', async () => {
  const { source, asset } = prepared(),
    library = addSource(fixture(), source, asset),
    methods = actions()
  library.materialFolders = [
    { id: 'folder', name: 'Folder', order: 0, createdAt: new Date().toISOString() },
  ]
  library.sources = Array.from({ length: 1000 }, (_, index) => ({
    ...source,
    id: `source-${index}`,
    title: `Material ${index}`,
    folderId: 'folder',
    order: index,
  }))
  mount(() =>
    h(MaterialTree, {
      library,
      scope: 'local:one',
      selectedId: 'source-0',
      busy: false,
      actions: methods,
    }),
  )
  await settle()
  expect(document.querySelectorAll('.material-tree li')).toHaveLength(200)
  click('加载更多')
  await settle()
  expect(document.querySelectorAll('.material-tree li')).toHaveLength(400)
  document.querySelector<HTMLButtonElement>('.folder-title')!.click()
  await settle()
  expect(document.querySelectorAll('.material-tree li')).toHaveLength(1)
  document.querySelector<HTMLButtonElement>('.folder-title')!.click()
  await settle()
  expect(document.querySelectorAll('.material-tree li')).toHaveLength(200)
  expect(document.body.textContent).toContain('Material 198')
  expect(document.body.textContent).not.toContain('Material 999')
})

it('applies queue and title filters to the outline while retaining the matching material ancestors', async () => {
  const { source, asset } = prepared()
  const library = addSource(fixture(), source, asset)
  library.sources = [
    { ...source, id: 'parent', title: 'Parent document' },
    { ...source, id: 'matching', title: 'Matching child', parentSourceId: 'parent' },
    { ...source, id: 'hidden', title: 'Unrelated document' },
  ]
  const visible = ref(new Set(['matching']))
  mount(() =>
    h(MaterialTree, {
      library,
      scope: 'local:one',
      selectedId: 'matching',
      busy: false,
      actions: actions(),
      visibleSourceIds: visible.value,
    }),
  )
  await settle()
  expect(document.body.textContent).toContain('Parent document')
  expect(document.body.textContent).toContain('Matching child')
  expect(document.body.textContent).not.toContain('Unrelated document')
  visible.value = new Set(['hidden'])
  await settle()
  expect(document.body.textContent).not.toContain('Matching child')
  expect(document.body.textContent).toContain('Unrelated document')
})
