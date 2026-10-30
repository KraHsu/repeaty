// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, shallowRef, type App } from 'vue'
import SourceConnections from './SourceConnections.vue'
import type { useSourceConnections } from '../app/useSourceConnections'
import type { SourceConnectionApi } from '../application/library-connections'
import type { CollectionHostApi } from '@repeaty/plugin-api'
import type { SourceCandidate, SourceConnection } from '../core/collection-data'
import { prepareSource } from '../core/sources'

let app: App | undefined
afterEach(() => {
  app?.unmount()
  app = undefined
  document.body.replaceChildren()
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
const connection: SourceConnection = {
  id: 'connection',
  pluginId: 'repeaty-directory',
  connectorId: 'text-directory',
  title: 'Study notes',
  mode: 'import',
  status: 'connected',
  settings: { input: 'directory' },
  intervalHours: 0,
  generation: 0,
  createdAt: '2026-10-30T00:00:00.000Z',
}
const candidate: SourceCandidate = {
  id: 'candidate',
  connectionId: connection.id,
  key: 'note.md',
  fingerprint: 'a'.repeat(64),
  kind: 'update',
  sourceId: 'source',
  baseMediaId: 'accepted',
  title: 'Updated note',
  format: 'plain',
  url: '',
  mediaId: 'candidate-media',
  characters: 15,
  discoveredAt: '2026-10-30T01:00:00.000Z',
}
function controllerFixture(candidates = [candidate], connected: SourceConnection[] = [connection]) {
  let revision = 7
  const api: SourceConnectionApi = {
    snapshot: () => ({ revision, workspaceScope: 'one', connections: [connection], candidates }),
    save: vi.fn(),
    stage: vi.fn(),
    markChecked: vi.fn(),
    resolve: vi.fn(async () => ({ sourceId: 'source' })),
    readCandidate: vi.fn(async () => 'upstream text'),
  }
  const controller = {
    api: shallowRef(api),
    connections: shallowRef(connected),
    candidates: shallowRef(candidates),
    connectors: shallowRef([
      {
        pluginId: 'repeaty-directory',
        id: 'text-directory',
        title: 'Markdown / 文本目录',
        kind: 'directory',
        fields: [],
      },
    ]),
    running: shallowRef<string[]>([]),
    needsAuthorization: shallowRef<string[]>([]),
    originals: shallowRef(new Map()),
    error: shallowRef(''),
    progress: shallowRef(''),
    native: false,
    scan: vi.fn(),
    save: vi.fn(),
    chooseDirectory: vi.fn(),
    disconnect: vi.fn(),
    cancel: vi.fn(),
  } as unknown as ReturnType<typeof useSourceConnections>
  return { controller, api, advance: () => revision++ }
}
function sourceFixture() {
  const source = prepareSource({
    title: 'Local note',
    content: 'local text',
    format: 'plain',
    url: '',
  }).source
  source.id = 'source'
  source.mediaId = 'local'
  source.binding = {
    connectionId: connection.id,
    key: 'note.md',
    acceptedMediaId: 'accepted',
    fingerprint: 'b'.repeat(64),
  }
  return source
}

it('compares local edits and the previous accepted text before accepting a source update', async () => {
  const fixture = controllerFixture(),
    source = sourceFixture()
  const read = vi.fn(async (_id: string, _signal?: AbortSignal, version?: string) =>
    version === 'local' ? 'local text' : 'accepted text',
  )
  const host = mount(() =>
    h(SourceConnections, { controller: fixture.controller, sources: [source], getSource: read }),
  )
  await vi.waitFor(() => expect(host.textContent).toContain('本地正文也有修改'))
  expect(
    [...host.querySelectorAll('.connection-diff pre')].map((element) => element.textContent),
  ).toEqual(['local text', 'upstream text'])
  expect(host.querySelector('.connection-base pre')?.textContent).toBe('accepted text')
  expect(fixture.api.resolve).not.toHaveBeenCalled()
  button('采用来源更新').click()
  await vi.waitFor(() =>
    expect(fixture.api.resolve).toHaveBeenCalledWith({
      candidateId: 'candidate',
      action: 'accept',
      expectedRevision: 7,
      expectedMediaId: 'local',
      targetSourceId: undefined,
    }),
  )
  expect(source.mediaId).toBe('local')
})

it('refuses to present a comparison assembled across library revisions', async () => {
  const fixture = controllerFixture(),
    source = sourceFixture()
  let finish: (text: string) => void = () => {}
  fixture.api.readCandidate = vi.fn(
    () =>
      new Promise<string>((resolve) => {
        finish = resolve
      }),
  )
  const host = mount(() =>
    h(SourceConnections, {
      controller: fixture.controller,
      sources: [source],
      getSource: async () => 'local text',
    }),
  )
  await vi.waitFor(() => expect(fixture.api.readCandidate).toHaveBeenCalled())
  fixture.advance()
  finish('upstream')
  await vi.waitFor(() => expect(host.textContent).toContain('学习库已变化，请重新查看对比。'))
  expect(host.querySelector('.connection-diff')).toBeNull()
  expect(fixture.api.resolve).not.toHaveBeenCalled()
})

it('ignores a late candidate body after another candidate is selected', async () => {
  const second = {
    ...candidate,
    id: 'candidate-two',
    kind: 'add' as const,
    sourceId: undefined,
    title: 'Second candidate',
    key: 'two.md',
  }
  const fixture = controllerFixture([candidate, second])
  let finish: (text: string) => void = () => {}
  fixture.api.readCandidate = vi.fn((id) =>
    id === candidate.id
      ? new Promise<string>((resolve) => {
          finish = resolve
        })
      : Promise.resolve('second body'),
  )
  const host = mount(() =>
    h(SourceConnections, {
      controller: fixture.controller,
      sources: [sourceFixture()],
      getSource: async () => 'local text',
    }),
  )
  await vi.waitFor(() => expect(fixture.api.readCandidate).toHaveBeenCalled())
  ;[...host.querySelectorAll<HTMLButtonElement>('.connection-pending button')]
    .find((element) => element.textContent?.includes('Second candidate'))!
    .click()
  await vi.waitFor(() =>
    expect(host.querySelector('.connection-diff pre')?.textContent).toBe('second body'),
  )
  finish('late body')
  await nextTick()
  expect(host.querySelector('.connection-diff pre')?.textContent).toBe('second body')
})

it('requires explicit confirmation before disconnecting and keeps connection data on failure', async () => {
  const fixture = controllerFixture([])
  fixture.controller.disconnect = vi.fn(async () => {
    throw new Error('Storage failed')
  })
  mount(() =>
    h(SourceConnections, {
      controller: fixture.controller,
      sources: [],
      getSource: async () => '',
    }),
  )
  button('断开').click()
  await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).not.toBeNull())
  expect(fixture.controller.disconnect).not.toHaveBeenCalled()
  button('确认断开').click()
  await vi.waitFor(() => expect(document.body.textContent).toContain('Storage failed'))
  expect(document.querySelector('[role="dialog"]')).not.toBeNull()
  expect(fixture.controller.connections.value).toEqual([connection])
})

it('keeps indexed reads read-only until an explicit collection action and rechecks the file first', async () => {
  const fixture = controllerFixture(
    [],
    [{ ...connection, mode: 'index', settings: { directoryId: 'grant' } }],
  )
  const entry = { path: 'vault/note.md', size: 4, modified: '123', snippet: 'body' }
  fixture.controller.searchIndex = vi.fn(async () => ({ hits: [entry], more: false, indexedAt: 1 }))
  fixture.controller.readIndexed = vi.fn(async () => 'body')
  const collection: CollectionHostApi = {
    snapshot: () => ({ revision: 7, workspaceScope: 'one' }),
    prepareCollection: vi.fn(async () => ({
      id: 'collection',
      revision: 7,
      candidates: [
        { key: 'one', title: 'note', format: 'markdown', sourceName: 'note.md', duplicate: false },
      ],
      skipped: [],
    })),
    commitCollection: vi.fn(async () => ({ sourceIds: ['new'], revision: 8 })),
    discardCollection: vi.fn(),
    organizeInbox: vi.fn(),
  }
  const host = mount(() =>
    h(SourceConnections, {
      controller: fixture.controller,
      collection,
      sources: [],
      getSource: async () => '',
    }),
  )
  const field = host.querySelector<HTMLInputElement>('input[type="search"]')!
  field.value = 'body'
  field.dispatchEvent(new Event('input', { bubbles: true }))
  await nextTick()
  host
    .querySelector('form')!
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  await vi.waitFor(() =>
    expect(host.querySelector('.connection-index-results button')).not.toBeNull(),
  )
  host.querySelector<HTMLButtonElement>('.connection-index-results button')!.click()
  await vi.waitFor(() =>
    expect(host.querySelector('.connection-index-preview pre')?.textContent).toBe('body'),
  )
  expect(collection.prepareCollection).not.toHaveBeenCalled()
  button('收集到收件箱').click()
  await vi.waitFor(() => expect(host.textContent).toContain('已收集到收件箱。'))
  expect(fixture.controller.readIndexed).toHaveBeenCalledTimes(2)
  expect(fixture.controller.readIndexed).toHaveBeenLastCalledWith(connection.id, entry)
  expect(collection.commitCollection).toHaveBeenCalledWith(
    expect.objectContaining({ planId: 'collection', expectedRevision: 7 }),
  )
  expect(collection.discardCollection).toHaveBeenCalledWith('collection')
})

it('does not collect an indexed file whose text changed since preview', async () => {
  const fixture = controllerFixture([], [{ ...connection, mode: 'index' }])
  fixture.controller.searchIndex = vi.fn(async () => ({
    hits: [{ path: 'note.txt', size: 4, modified: '123', snippet: 'body' }],
    more: false,
    indexedAt: 1,
  }))
  fixture.controller.readIndexed = vi
    .fn()
    .mockResolvedValueOnce('body')
    .mockResolvedValueOnce('changed')
  const collection = { prepareCollection: vi.fn() } as unknown as CollectionHostApi
  const host = mount(() =>
    h(SourceConnections, {
      controller: fixture.controller,
      collection,
      sources: [],
      getSource: async () => '',
    }),
  )
  const field = host.querySelector<HTMLInputElement>('input[type="search"]')!
  field.value = 'body'
  field.dispatchEvent(new Event('input', { bubbles: true }))
  await nextTick()
  host
    .querySelector('form')!
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  await vi.waitFor(() =>
    expect(host.querySelector('.connection-index-results button')).not.toBeNull(),
  )
  host.querySelector<HTMLButtonElement>('.connection-index-results button')!.click()
  await vi.waitFor(() =>
    expect(host.querySelector('.connection-index-preview pre')?.textContent).toBe('body'),
  )
  button('收集到收件箱').click()
  await vi.waitFor(() => expect(host.textContent).toContain('文件内容已变化'))
  expect(collection.prepareCollection).not.toHaveBeenCalled()
  expect(host.querySelector('.connection-index-preview pre')?.textContent).toBe('body')
})

it('keeps missing directory authorization visible and provides a direct recovery action', async () => {
  const fixture = controllerFixture([], [connection])
  fixture.controller.needsAuthorization.value.push(connection.id)
  const host = mount(() =>
    h(SourceConnections, {
      controller: fixture.controller,
      sources: [],
      getSource: async () => '',
    }),
  )
  await nextTick()
  expect(host.textContent).toContain('需要重新关联')
  expect(button('检查更新').disabled).toBe(true)
  button('选择目录并重新关联').click()
  await nextTick()
  expect(document.querySelector('[role="dialog"]')).not.toBeNull()
  const input = document.querySelector<HTMLInputElement>('input[webkitdirectory]')
  expect(input?.tabIndex).toBe(-1)
  expect(fixture.controller.scan).not.toHaveBeenCalled()
})
