// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, reactive, ref, shallowRef, type Component, type VNode } from 'vue'
import { fixture, now } from '../core/test-fixtures'
import type { NoteInput, MediaUpload } from '../core/model'
import type { SourceQueueUpdate } from '../core/source-data'
import { addSource, prepareSource } from '../core/sources'
import type { ReadingProgress } from '../composables/useReadingProgress'
import NoteEditor from './NoteEditor.vue'
import SourcePanel from './SourcePanel.vue'
import EditorDialogs from '../app/views/EditorDialogs.vue'

const context = vi.hoisted(() => ({ application: {} as Record<string, unknown> }))
vi.mock('../app/context', () => ({ useApplication: () => context.application }))
vi.mock('../plugins', async () => {
  const { ref } = await import('vue')
  return { usePlugins: () => ({ enabledEditorPlugins: ref([]), canReviewCard: () => true }) }
})
vi.mock('../plugins/manager', () => ({
  usePluginManager: () => ({ holdPluginRuntime: () => () => {} }),
}))
vi.mock('./AppModal.vue', () => ({
  default: {
    setup:
      (_props: unknown, { slots }: { slots: { default?: () => VNode[] } }) =>
      () =>
        h('section', {}, slots.default?.()),
  },
}))
vi.mock('./SourceReader.vue', () => ({
  default: {
    setup: (_props: unknown, { expose }: { expose: (value: unknown) => void }) => {
      expose({
        ready: true,
        capture: () => ({ position: { offset: 0, fraction: 0, view: 'source' } }),
      })
      return () => h('div', 'Reading surface')
    },
  },
}))

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
  vi.restoreAllMocks()
})
function mount(component: Component, props: Record<string, unknown> = {}) {
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp({ render: () => h(component, props) })
  app.mount(host)
  cleanups.push(() => {
    app.unmount()
    host.remove()
  })
  return host
}
async function choose(trigger: HTMLElement, value: string) {
  trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
  let option: HTMLElement | null = null
  await vi.waitFor(() => {
    option =
      document
        .querySelector(`[data-select-value="${value}"]`)
        ?.closest<HTMLElement>('[role=option]') ?? null
    expect(option).not.toBeNull()
  })
  option!.focus()
  option!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  await vi.waitFor(() => expect(trigger.getAttribute('aria-expanded')).toBe('false'))
}
it('keeps deck color radios checked for initial, clicked and externally changed values', async () => {
  const library = fixture()
  const deckForm = reactive({ ...library.decks[0]!, color: 'blue' })
  context.application = {
    library: shallowRef(library),
    deckForm,
    modal: ref('deck'),
    busy: ref(false),
    retentionPercent: ref(90),
    workspace: {},
  }
  const host = mount(EditorDialogs)
  await nextTick()
  const radio = (value: string) =>
    host.querySelector<HTMLButtonElement>(`[role=radio][value="${value}"]`)!
  expect(radio('blue').getAttribute('aria-checked')).toBe('true')
  radio('rose').click()
  await nextTick()
  expect(deckForm.color).toBe('rose')
  expect(radio('rose').getAttribute('aria-checked')).toBe('true')
  deckForm.color = 'sand'
  await nextTick()
  expect(radio('sand').getAttribute('aria-checked')).toBe('true')
  expect(radio('rose').getAttribute('aria-checked')).toBe('false')
})
it('requires explicit confirmation before saving a note that removes a generated card', async () => {
  const library = fixture({ type: 'reversed' })
  const submit = vi.fn(
    async (_input: NoteInput, _uploads: MediaUpload[], _allowRemove: boolean) => true,
  )
  const host = mount(NoteEditor, {
    library,
    note: library.notes[0],
    busy: false,
    submit,
    getMedia: async () => undefined,
  })
  await choose(host.querySelector<HTMLElement>('#note-type')!, 'basic')
  await vi.waitFor(() => expect(host.querySelector('[name=confirm-removed-cards]')).not.toBeNull())
  const form = host.querySelector('form')!
  const native = host.querySelector<HTMLInputElement>('input[name=confirm-removed-cards]')!
  expect(native.required).toBe(true)
  expect(native.checked).toBe(false)
  expect(form.checkValidity()).toBe(false)
  // The business guard also protects programmatic/shortcut submission if native
  // validity is bypassed by an embedding host.
  vi.spyOn(form, 'reportValidity').mockReturnValue(true)
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  await nextTick()
  expect(submit).not.toHaveBeenCalled()
  host.querySelector<HTMLButtonElement>('[role=checkbox]')!.click()
  await nextTick()
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  await vi.waitFor(() => expect(submit).toHaveBeenCalledOnce())
  expect(submit.mock.calls[0]?.[2]).toBe(true)
})
it('keeps the required deck selection in native form validation', async () => {
  const submit = vi.fn(async () => true)
  const host = mount(NoteEditor, {
    library: fixture(),
    busy: false,
    submit,
    getMedia: async () => undefined,
    initial: { deckId: '', front: 'Question', back: 'Answer' },
  })
  await nextTick()
  const native = host.querySelector<HTMLSelectElement>('select[name=deckId]')!
  expect(native).not.toBeNull()
  expect(native.required).toBe(true)
  expect(host.querySelector('form')!.checkValidity()).toBe(false)
  host
    .querySelector('form')!
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  await nextTick()
  expect(submit).not.toHaveBeenCalled()
})
it('keeps reading priority persisted on failure and resets adaptive feedback to its checked default', async () => {
  const prepared = prepareSource(
    { title: 'Source', url: '', format: 'plain', content: 'Reading body' },
    now,
  )
  prepared.source.priority = 'high'
  const library = shallowRef(addSource(fixture(), prepared.source, prepared.asset))
  const arrange = vi.fn(async (_update: SourceQueueUpdate) => false)
  const reading = {
    pending: new Map(),
    savingId: ref(''),
    hold: () => () => {},
    acknowledge: vi.fn(),
  } as unknown as ReadingProgress
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp({
    render: () =>
      h(SourcePanel, {
        library: library.value,
        busy: false,
        scope: 'workspace',
        reading,
        now,
        canUndoReading: false,
        arrangeBatch: async () => true,
        undoReading: async () => true,
        read: async () => 'Reading body',
        save: async () => true,
        updateDetails: async () => true,
        saveExcerpt: async () => true,
        remove: async () => true,
        arrange,
        saveReading: async () => true,
      }),
  })
  app.mount(host)
  cleanups.push(() => {
    app.unmount()
    host.remove()
  })
  await vi.waitFor(() => expect(host.querySelector('#source-reading-priority')).not.toBeNull())
  const priority = host.querySelector<HTMLElement>('#source-reading-priority')!
  expect(priority.textContent).toContain('高')
  await choose(priority, 'low')
  await vi.waitFor(() => expect(arrange).toHaveBeenCalledOnce())
  expect(arrange.mock.calls[0]![0].action).toEqual({ type: 'priority', priority: 'low' })
  expect(priority.textContent).toContain('高')
  library.value = {
    ...library.value,
    sources: library.value.sources.map((source) => ({ ...source, priority: 'normal' })),
  }
  await nextTick()
  expect(priority.textContent).toContain('普通')
  const schedule = [...host.querySelectorAll<HTMLButtonElement>('button')].find((button) =>
    button.textContent?.includes('读过，安排下次'),
  )!
  expect(schedule).toBeDefined()
  schedule.click()
  await nextTick()
  await choose(host.querySelector<HTMLElement>('#reading-schedule-mode')!, 'adaptive')
  const feedback = (value: string) =>
    host.querySelector<HTMLButtonElement>(`[role=radio][value="${value}"]`)!
  expect(feedback('good').getAttribute('aria-checked')).toBe('true')
  feedback('easy').click()
  await nextTick()
  expect(feedback('easy').getAttribute('aria-checked')).toBe('true')
  const cancel = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
    (button) => button.textContent?.trim() === '取消',
  )!
  cancel.click()
  await nextTick()
  schedule.click()
  await nextTick()
  await choose(host.querySelector<HTMLElement>('#reading-schedule-mode')!, 'adaptive')
  expect(feedback('good').getAttribute('aria-checked')).toBe('true')
})
