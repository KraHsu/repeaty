// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, reactive, ref, type App } from 'vue'
import type { CollectionHostApi, CollectionImportPlan } from '@repeaty/plugin-api'
import CollectionImport from './CollectionImport.vue'
import InboxPanel from './InboxPanel.vue'
import { prepareSource } from '../core/sources'

vi.mock('./SourceReader.vue', () => ({
  default: defineComponent({
    props: ['text'],
    setup: (props) => () => h('div', { 'data-reader': '' }, props.text),
  }),
}))
let app: App | undefined
afterEach(() => {
  app?.unmount()
  app = undefined
  document.body.replaceChildren()
  vi.unstubAllGlobals()
})
function mount(render: () => ReturnType<typeof h>) {
  const host = document.createElement('div')
  document.body.append(host)
  app = createApp({ render })
  app.mount(host)
  return host
}
function button(label: string) {
  const found = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (element) => element.textContent?.trim() === label,
  )
  if (!found) throw new Error(`Missing button: ${label}`)
  return found
}
async function fill(selector: string, value: string) {
  const field = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!
  field.value = value
  field.dispatchEvent(new Event('input', { bubbles: true }))
  await nextTick()
}
const plan = (): CollectionImportPlan => ({
  id: 'prepared',
  revision: 3,
  candidates: [
    {
      key: 'one',
      title: 'Collected title',
      duplicate: false,
      format: 'markdown',
      sourceName: 'note.md',
    },
  ],
  skipped: [],
})
function api(overrides: Partial<CollectionHostApi> = {}): CollectionHostApi {
  return {
    snapshot: () => ({ revision: 3, workspaceScope: 'scope-one' }),
    prepareCollection: vi.fn(async () => plan()),
    discardCollection: vi.fn(),
    commitCollection: vi.fn(async () => ({ sourceIds: ['saved'], revision: 4 })),
    organizeInbox: vi.fn(async () => ({ revision: 4 })),
    ...overrides,
  }
}
async function importText(backend: CollectionHostApi, state = reactive({ scope: 'one' })) {
  const component = ref<InstanceType<typeof CollectionImport>>()
  const collected = vi.fn()
  mount(() =>
    h(CollectionImport, {
      ref: component,
      api: backend,
      scope: state.scope,
      onCollected: collected,
    }),
  )
  component.value!.show()
  await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).not.toBeNull())
  button('粘贴或输入文字').click()
  await nextTick()
  await fill('#collection-text', 'A useful passage')
  return { component, collected, state }
}

it('keeps the prepared selection after a save failure and retries with the same operation identity', async () => {
  const commit = vi
    .fn<CollectionHostApi['commitCollection']>()
    .mockRejectedValueOnce(new Error('Disk full'))
    .mockResolvedValueOnce({ sourceIds: ['saved'], revision: 4 })
  const backend = api({ commitCollection: commit })
  const { collected } = await importText(backend)
  button('预览材料').click()
  await vi.waitFor(() => expect(document.body.textContent).toContain('Collected title'))
  button('保存到收件箱').click()
  await vi.waitFor(() => expect(document.body.textContent).toContain('Disk full'))
  expect(document.querySelector('[role="dialog"]')).not.toBeNull()
  button('保存到收件箱').click()
  await vi.waitFor(() => expect(collected).toHaveBeenCalledWith(['saved'], 'inbox'))
  expect(commit).toHaveBeenCalledTimes(2)
  expect(commit.mock.calls[0]![0]).toEqual(commit.mock.calls[1]![0])
  expect(backend.discardCollection).toHaveBeenCalledWith('prepared')
})

it('discards a late preview after switching libraries and never emits it into the new library', async () => {
  let finish: (plan: CollectionImportPlan) => void = () => {}
  const prepare = vi.fn<CollectionHostApi['prepareCollection']>(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  const backend = api({ prepareCollection: prepare })
  const { state, collected } = await importText(backend)
  button('预览材料').click()
  await vi.waitFor(() => expect(prepare).toHaveBeenCalledOnce())
  const signal = prepare.mock.calls[0]![1]!
  state.scope = 'two'
  await nextTick()
  expect(signal.aborted).toBe(true)
  finish(plan())
  await vi.waitFor(() => expect(backend.discardCollection).toHaveBeenCalledWith('prepared'))
  expect(collected).not.toHaveBeenCalled()
  expect(document.querySelector('[role="dialog"]')).toBeNull()
})

it('returns from preview with typed text intact and uses only the explicit selected candidates', async () => {
  const backend = api({
    prepareCollection: vi.fn(async () => ({
      ...plan(),
      candidates: [
        ...plan().candidates,
        { ...plan().candidates[0]!, key: 'two', title: 'Other title' },
      ],
    })),
  })
  await importText(backend)
  button('预览材料').click()
  await vi.waitFor(() => expect(document.body.textContent).toContain('Other title'))
  button('返回修改').click()
  await nextTick()
  expect(document.querySelector<HTMLTextAreaElement>('#collection-text')!.value).toBe(
    'A useful passage',
  )
  button('预览材料').click()
  await vi.waitFor(() => expect(document.querySelectorAll('[role="checkbox"]')).toHaveLength(2))
  document.querySelectorAll<HTMLButtonElement>('[role="checkbox"]')[1]!.click()
  await nextTick()
  button('保存到收件箱').click()
  await vi.waitFor(() => expect(backend.commitCollection).toHaveBeenCalled())
  expect(backend.commitCollection).toHaveBeenCalledWith(
    expect.objectContaining({ selection: ['one'] }),
  )
})

it('reports clipboard permission denial and preserves existing text for direct paste', async () => {
  vi.stubGlobal('navigator', {
    clipboard: {
      read: async () => {
        throw new DOMException('denied', 'NotAllowedError')
      },
    },
  })
  await importText(api())
  button('读取剪贴板').click()
  await vi.waitFor(() => expect(document.body.textContent).toContain('请允许读取'))
  expect(document.querySelector<HTMLTextAreaElement>('#collection-text')!.value).toBe(
    'A useful passage',
  )
})

function inboxSource(title: string, content: string) {
  const { source } = prepareSource({ title, content, format: 'plain', url: '' })
  source.inbox = { state: 'new', capturedAt: '2026-10-30T00:00:00.000Z', kind: 'clipboard' }
  return source
}
it('does not replace the selected inbox body with a late response from a previous item', async () => {
  const first = inboxSource('First item', 'first'),
    second = inboxSource('Second item', 'second')
  let finish: (body: string) => void = () => {}
  const read = vi.fn((id: string) =>
    id === first.id
      ? new Promise<string>((resolve) => {
          finish = resolve
        })
      : Promise.resolve('second body'),
  )
  mount(() => h(InboxPanel, { api: api(), scope: 'one', sources: [first, second], read }))
  await vi.waitFor(() => expect(read).toHaveBeenCalledOnce())
  const target = [...document.querySelectorAll<HTMLButtonElement>('.inbox-list button')].find(
    (element) => element.textContent?.includes('Second item'),
  )!
  target.click()
  await vi.waitFor(() =>
    expect(document.querySelector('[data-reader]')?.textContent).toBe('second body'),
  )
  finish('first body')
  await nextTick()
  expect(document.querySelector('[data-reader]')?.textContent).toBe('second body')
})

it('keeps an inbox organization draft after a failed transaction and binds its original revision', async () => {
  const source = inboxSource('Inbox title', 'body')
  const organize = vi
    .fn<CollectionHostApi['organizeInbox']>()
    .mockRejectedValue(new Error('Stale revision'))
  mount(() =>
    h(InboxPanel, {
      api: api({ organizeInbox: organize }),
      scope: 'one',
      sources: [source],
      read: async () => 'body',
    }),
  )
  button('整理到阅读材料').click()
  await vi.waitFor(() => expect(document.querySelector('#inbox-title')).not.toBeNull())
  await fill('#inbox-title', 'Edited title')
  document
    .querySelector('form')!
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  await vi.waitFor(() => expect(document.body.textContent).toContain('Stale revision'))
  expect(document.querySelector<HTMLInputElement>('#inbox-title')!.value).toBe('Edited title')
  expect(source.title).toBe('Inbox title')
  expect(source.inbox?.state).toBe('new')
  expect(organize).toHaveBeenCalledWith(
    expect.objectContaining({ title: 'Edited title', expectedRevision: 3, action: 'file' }),
  )
})

it('does not lose an open request when a background save becomes busy during navigation', async () => {
  const component = ref<InstanceType<typeof CollectionImport>>()
  const state = reactive({ busy: false })
  const backend = api()
  mount(() => h(CollectionImport, { ref: component, api: backend, scope: 'one', busy: state.busy }))
  state.busy = true
  await nextTick()
  component.value!.show()
  await nextTick()
  expect(document.querySelector('[role="dialog"]')).not.toBeNull()
  expect(button('选择文件').disabled).toBe(true)
  expect(backend.prepareCollection).not.toHaveBeenCalled()
  state.busy = false
  await nextTick()
  expect(button('选择文件').disabled).toBe(false)
})
