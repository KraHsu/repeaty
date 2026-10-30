import { expect, it, vi } from 'vitest'
import { createDiscourse } from './client'
import {
  PartialMutation,
  RemoteRejected,
  createPublisher,
  emptyLedger,
  publicationMarker,
  type Connection,
  type Draft,
} from '@repeaty/publishing-client'
const connection: Connection = { site: 'https://forum.example', adapter: 'user-api', slot: 'forum' }
const marker = await publicationMarker(connection.site, 's')
const draft: Draft = {
  sourceId: 's',
  versionId: 'v',
  title: '如何安排复习？',
  content: '正文',
  category: '2',
  tags: ['学习'],
  status: 'publish',
}
const state = { slots: [{ slot: 'forum', origin: connection.site, revision: 1 }] }
it('keeps a forum subpath in the public topic link', async () => {
  const native = vi.fn(async (operation: string, input: unknown) => {
    if (operation === 'secrets') return state
    const path = new URL((input as { url: string }).url).pathname
    expect(path).toMatch(/^\/community\//)
    const body = path.endsWith('/posts/7.json')
      ? { id: 7, topic_id: 9, post_number: 1, raw: 'body', version: 1 }
      : { id: 9, title: 'Title', category_id: 2, tags: [] }
    return {
      status: 200,
      body: JSON.stringify(body),
      headers: {},
      credentialRevision: 1,
      currentCredentialRevision: 1,
    }
  })
  const result = await createDiscourse(native, {
    ...connection,
    site: connection.site + '/community',
  }).read('7', new AbortController().signal)
  expect(result?.url).toBe('https://forum.example/community/t/9')
})
it('never treats readback rejection after a successful create as a safe create retry', async () => {
  let count = 0
  const native = vi.fn(async (operation: string) =>
    operation === 'secrets'
      ? state
      : {
          status: ++count === 1 ? 200 : 403,
          body: '{"id":7}',
          headers: {},
          credentialRevision: 1,
          currentCredentialRevision: 1,
        },
  )
  await expect(
    createDiscourse(native, connection).create(draft, marker, new AbortController().signal),
  ).rejects.toBeInstanceOf(PartialMutation)
  expect(count).toBe(2)
  await expect(
    createDiscourse(native, connection).create(draft, marker, new AbortController().signal),
  ).rejects.toBeInstanceOf(RemoteRejected)
})
it('creates a topic, finds its raw marker through owner activity, and updates the first post with a conflict precondition', async () => {
  let raw = ''
  const requests: { url: string; method: string; body?: string }[] = []
  const native = vi.fn(async (operation: string, payload: unknown) => {
    if (operation === 'secrets') return state
    const request = payload as { url: string; method: string; body?: string }
    requests.push(request)
    const path = new URL(request.url).pathname
    let body: unknown = {}
    if (request.method === 'POST') {
      raw = JSON.parse(request.body!).raw
      body = { id: 7, topic_id: 9 }
    } else if (request.method === 'PUT' && path === '/posts/7.json') {
      const post = JSON.parse(request.body!).post
      expect(post.original_text).toBe(raw)
      raw = post.raw
      body = { post: { id: 7 } }
    } else if (path === '/posts/7.json')
      body = { id: 7, topic_id: 9, post_number: 1, raw, version: 1 }
    else if (path.startsWith('/t/'))
      body = {
        id: 9,
        title: draft.title,
        category_id: 2,
        tags: draft.tags,
        post_stream: { posts: [{ id: 7, post_number: 1 }] },
      }
    else if (path === '/session/current.json') body = { current_user: { username: 'learner' } }
    else if (path === '/user_actions.json')
      body = { user_actions: [{ post_id: null, topic_id: 9 }] }
    return {
      status: 200,
      body: JSON.stringify(body),
      headers: {},
      credentialRevision: 1,
      currentCredentialRevision: 1,
    }
  })
  const api = createDiscourse(native, connection)
  const signal = new AbortController().signal
  await api.verify(signal)
  const remote = await api.create(draft, marker, signal)
  expect(remote.id).toBe('7')
  expect(remote.topicId).toBe('9')
  expect(
    JSON.parse(requests.find((request) => request.method === 'POST')!.body!),
  ).not.toHaveProperty('external_id')
  expect((await api.find(marker, signal))?.id).toBe('7')
  const restored = createPublisher(api, {
    load: async () => emptyLedger(),
    save: async () => undefined,
  })
  // A real source marker is deterministic; inspect the post after restoring an old local ledger.
  const recovered = await restored.preview(draft, signal)
  expect(recovered.action).toBe('update')
  await api.update(remote, { ...draft, content: '更新' }, marker, signal)
  expect(
    requests
      .filter((request) => request.method === 'PUT')
      .map((request) => new URL(request.url).pathname),
  ).toEqual(['/posts/7.json', '/t/9.json'])
})
it('rejects cross-origin reconciliation redirects without sending credentials to the target', async () => {
  const native = vi.fn(async (operation: string) =>
    operation === 'secrets'
      ? state
      : {
          status: 301,
          headers: { location: 'https://attacker.example/t/9.json' },
          body: '',
          credentialRevision: 1,
          currentCredentialRevision: 1,
        },
  )
  await expect(
    createDiscourse(native, connection).find(marker, new AbortController().signal),
  ).rejects.toThrow('remote-http-301')
  expect(native).toHaveBeenCalledTimes(2)
})
it('does not treat an unreadable own topic as proof that no previous post exists', async () => {
  const native = vi.fn(async (operation: string, input: unknown) => {
    if (operation === 'secrets') return state
    const path = new URL((input as { url: string }).url).pathname
    const body =
      path === '/session/current.json'
        ? { current_user: { username: 'learner' } }
        : path === '/user_actions.json'
          ? { user_actions: [{ post_id: 7, topic_id: 9 }] }
          : {}
    return {
      status: path === '/posts/7.json' ? 404 : 200,
      body: JSON.stringify(body),
      headers: {},
      credentialRevision: 1,
      currentCredentialRevision: 1,
    }
  })
  await expect(
    createDiscourse(native, connection).find(marker, new AbortController().signal),
  ).rejects.toThrow('remote-unconfirmed')
})
it('propagates a topic metadata failure after updating the post, so the durable engine can reconcile partial writes', async () => {
  let writes = 0
  const native = vi.fn(async (operation: string) => {
    if (operation === 'secrets') return state
    writes++
    return {
      status: writes === 1 ? 200 : 403,
      body: '{}',
      headers: {},
      credentialRevision: 1,
      currentCredentialRevision: 1,
    }
  })
  const api = createDiscourse(native, connection)
  await expect(
    api.update(
      {
        id: '7',
        topicId: '9',
        content: 'before',
        title: '',
        category: '',
        tags: [],
        status: 'publish',
        url: 'https://forum.example/t/9',
        revision: '1',
      },
      draft,
      marker,
      new AbortController().signal,
    ),
  ).rejects.toThrow('remote-result-unknown')
  expect(writes).toBe(2)
})
