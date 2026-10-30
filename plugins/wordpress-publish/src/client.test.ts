import { expect, it, vi } from 'vitest'
import { createWordPress } from './client'
import {
  markerComment,
  PartialMutation,
  RemoteRejected,
  type Connection,
  type Draft,
} from '@repeaty/publishing-client'
const config: Connection = { site: 'https://blog.example', adapter: 'rest', slot: 'site' }
const marker = `repeaty-${'a'.repeat(40)}`
const draft: Draft = {
  sourceId: 's',
  versionId: 'v',
  title: '标题',
  content: '<p>正文</p>',
  status: 'draft',
  category: '2',
  tags: ['3'],
}
const state = { slots: [{ slot: 'site', origin: 'https://blog.example', revision: 2 }] }
it('uses REST page counts when taxonomy has an exact multiple of 100 terms', async () => {
  const native = vi.fn(async (operation: string, input: unknown) => {
    if (operation === 'secrets') return state
    expect(new URL((input as { url: string }).url).searchParams.get('page')).toBe('1')
    return {
      status: 200,
      body: JSON.stringify(
        Array.from({ length: 100 }, (_, i) => ({ id: i + 1, name: `标签${i}` })),
      ),
      headers: { 'x-wp-totalpages': '1' },
      credentialRevision: 2,
      currentCredentialRevision: 2,
    }
  })
  const result = await createWordPress(native, config).catalog(new AbortController().signal)
  expect(result.tags).toHaveLength(100)
  expect(result.categories).toHaveLength(100)
})
it('keeps a successful create followed by rejected readback ambiguous, while a rejected first write is retryable', async () => {
  let count = 0
  const native = vi.fn(async (operation: string) =>
    operation === 'secrets'
      ? state
      : {
          status: ++count === 1 ? 200 : 401,
          body: '{"id":7}',
          headers: {},
          credentialRevision: 2,
          currentCredentialRevision: 2,
        },
  )
  await expect(
    createWordPress(native, config).create(draft, marker, new AbortController().signal),
  ).rejects.toBeInstanceOf(PartialMutation)
  expect(count).toBe(2)
  await expect(
    createWordPress(native, config).create(draft, marker, new AbortController().signal),
  ).rejects.toBeInstanceOf(RemoteRejected)
})
function fixture() {
  let saved: Record<string, unknown> | undefined
  const requests: Record<string, unknown>[] = []
  const native = vi.fn(async (operation: string, raw: unknown) => {
    if (operation === 'secrets') return state
    const request = raw as Record<string, unknown>
    requests.push(request)
    const url = new URL(request.url as string)
    let body: unknown = {}
    if (url.pathname.endsWith('/users/me')) body = { id: 1 }
    else if (request.method === 'POST') {
      saved = JSON.parse(request.body as string) as Record<string, unknown>
      body = { id: 7, link: 'https://blog.example/post' }
    } else if (request.method === 'DELETE') {
      saved = undefined
      body = { id: 7, status: 'trash' }
    } else if (url.pathname.endsWith('/posts/7'))
      body = {
        id: 7,
        title: { raw: saved?.title },
        content: { raw: saved?.content },
        status: saved?.status,
        tags: saved?.tags,
        categories: saved?.categories,
        link: 'https://blog.example/post',
      }
    else if (url.pathname.endsWith('/posts')) body = []
    else if (url.pathname.endsWith('/categories')) body = [{ id: 2, name: '学习' }]
    else if (url.pathname.endsWith('/tags')) body = [{ id: 3, name: 'FSRS' }]
    return {
      status: 200,
      body: JSON.stringify(body),
      headers: {},
      credentialRevision: 2,
      currentCredentialRevision: 2,
    }
  })
  return { native, requests, saved: () => saved }
}
it('uses core REST create/edit context, stable slug, taxonomy and original post ID', async () => {
  const f = fixture()
  const api = createWordPress(f.native, config)
  const signal = new AbortController().signal
  await api.verify(signal)
  expect(await api.catalog(signal)).toEqual({
    categories: [{ id: '2', name: '学习' }],
    tags: [{ id: '3', name: 'FSRS' }],
  })
  const post = await api.create(draft, marker, signal)
  expect(post.id).toBe('7')
  expect(post.content).toContain(markerComment(marker))
  expect(f.saved()?.slug).toBe(marker)
  await api.update(post, { ...draft, content: '<p>更新</p>' }, marker, signal)
  expect(
    f.requests
      .filter((request) => request.method === 'POST')
      .map((request) => new URL(request.url as string).pathname),
  ).toEqual(['/wp-json/wp/v2/posts', '/wp-json/wp/v2/posts/7'])
  await api.remove(post, signal)
  expect(f.requests.at(-1)?.url).toContain('force=false')
})
it('does not follow an unexpected redirect or show a raw remote error', async () => {
  const native = vi.fn(async (operation: string) =>
    operation === 'secrets'
      ? state
      : {
          status: 302,
          body: 'secret server details',
          headers: { location: 'https://elsewhere.example' },
          credentialRevision: 2,
          currentCredentialRevision: 2,
        },
  )
  await expect(
    createWordPress(native, config).verify(new AbortController().signal),
  ).rejects.toThrow('remote-http-302')
  expect(native).toHaveBeenCalledTimes(2)
})
it('searches XML-RPC by marker before pagination so other authors do not hide an older matching post', async () => {
  const native = vi.fn(async (operation: string, payload: unknown) => {
    if (operation === 'secrets') return state
    const template = (payload as { secret: { body: { template: string } } }).secret.body.template
    // Without server-side search, a first page full of other authors is filtered to [].
    const searched = template.includes(`<name>s</name><value><string>${marker}</string>`)
    const post = `<value><struct><member><name>post_id</name><value><string>7</string></value></member><member><name>post_title</name><value><string>旧文章</string></value></member><member><name>post_content</name><value><string>&lt;!-- ${marker} --&gt;</string></value></member><member><name>post_status</name><value><string>publish</string></value></member><member><name>link</name><value><string>https://blog.example/post</string></value></member></struct></value>`
    return {
      status: 200,
      body: `<methodResponse><params><param><value><array><data>${searched ? post : ''}</data></array></value></param></params></methodResponse>`,
      headers: {},
      credentialRevision: 2,
      currentCredentialRevision: 2,
    }
  })
  const api = createWordPress(native, { ...config, adapter: 'xmlrpc', blogId: '1' })
  expect((await api.find(marker, new AbortController().signal))?.id).toBe('7')
})
it('matches an XML-RPC blog, stores no plaintext credential in JS requests and escapes template-like article text', async () => {
  const config: Connection = { site: 'https://blog.example', adapter: 'xmlrpc', slot: 'site' }
  const calls: string[] = []
  const response = (value: string) =>
    `<methodResponse><params><param><value>${value}</value></param></params></methodResponse>`
  const native = vi.fn(async (operation: string, payload: unknown) => {
    if (operation === 'secrets') return state
    const template = (payload as { secret: { body: { template: string } } }).secret.body.template
    calls.push(template)
    const body = template.includes('wp.getUsersBlogs')
      ? response(
          '<array><data><value><struct><member><name>blogid</name><value><string>9</string></value></member><member><name>url</name><value><string>https://blog.example/</string></value></member></struct></value></data></array>',
        )
      : template.includes('wp.newPost')
        ? response('<string>7</string>')
        : response(
            `<struct><member><name>post_id</name><value><string>7</string></value></member><member><name>post_title</name><value><string>标题</string></value></member><member><name>post_content</name><value><string>&lt;p&gt;正文&lt;/p&gt; &lt;!-- ${marker} --&gt;</string></value></member><member><name>post_status</name><value><string>draft</string></value></member><member><name>link</name><value><string>https://blog.example/post</string></value></member></struct>`,
          )
    return { status: 200, body, headers: {}, credentialRevision: 2, currentCredentialRevision: 2 }
  })
  const api = createWordPress(native, config)
  const signal = new AbortController().signal
  await api.verify(signal)
  expect(config.blogId).toBe('9')
  await api.create({ ...draft, content: '{{password}}' }, marker, signal)
  expect(calls[1]).toContain('&#123;&#123;password&#125;&#125;')
  expect(calls[1]?.match(/\{\{password\}\}/g)).toHaveLength(1)
})
