import { expect, it, vi } from 'vitest'
import { abortableDelay, createReadwiseApi, retryDelay } from './api'
function fixture(
  pages: (url: string, count: number) => unknown = () => ({ nextPageCursor: null, results: [] }),
) {
  let count = 0
  const native = vi.fn(async (operation: string, payload: unknown): Promise<unknown> => {
    if (operation === 'secrets')
      return { slots: [{ slot: 'readwise', origin: 'https://readwise.io', revision: 2 }] }
    const url = (payload as { url: string }).url
    return {
      status: 200,
      body: JSON.stringify(pages(url, count++)),
      headers: {},
      credentialRevision: 2,
      currentCredentialRevision: 2,
    }
  })
  const wait = vi.fn(async () => {})
  const context = { signal: new AbortController().signal, progress: vi.fn(), yield: async () => {} }
  return { api: createReadwiseApi(native, wait), native, wait, context }
}
it('keeps the token in a device slot and sends only a secret reference for GET calls', async () => {
  const { api, native, context } = fixture()
  await api.configure('sample-token')
  expect(native.mock.calls[0]).toEqual([
    'secrets',
    {
      action: 'set',
      slot: 'readwise',
      origin: 'https://readwise.io',
      values: { token: 'sample-token' },
    },
  ])
  await api.scan('reader', context)
  const call = native.mock.calls.find(([operation]) => operation === 'http')!
  expect(call[1]).toMatchObject({
    method: 'GET',
    secret: {
      slot: 'readwise',
      expectedRevision: 2,
      headers: { Authorization: 'Token {{token}}' },
    },
  })
  expect(JSON.stringify(call)).not.toContain('sample-token')
  await expect(api.configure('line\nbreak')).rejects.toThrow()
})
it('paginates both endpoints with bounded pacing and canonical source identity', async () => {
  const { api, native, wait, context } = fixture((url, count) =>
    url.includes('/v3/')
      ? count === 0
        ? {
            results: [{ id: 'one', title: '一', html_content: '<p>正文</p>' }],
            nextPageCursor: 'second',
          }
        : {
            results: [{ id: 'two', title: '二', html_content: '<p>第二篇</p>' }],
            nextPageCursor: null,
          }
      : {
          results: [
            {
              user_book_id: 5,
              source: 'reader',
              external_id: 'one',
              title: '一',
              highlights: [{ id: 1, text: '高亮' }],
            },
          ],
          nextPageCursor: null,
        },
  )
  const result = await api.scan('both', context)
  expect(result.items.map((item) => item.key)).toEqual(['reader:one', 'reader:two'])
  expect(result.items[0]?.text).toContain('高亮')
  expect(native.mock.calls.filter(([op]) => op === 'http')).toHaveLength(3)
  expect(wait).toHaveBeenCalledTimes(2)
  expect(result.complete).toBe(true)
})
it('aborts on repeated page cursors instead of publishing an incomplete snapshot', async () => {
  const { api, context } = fixture(() => ({ results: [], nextPageCursor: 'same' }))
  await expect(api.scan('reader', context)).rejects.toThrow('重复')
})
it('retries rate limiting, rejects account changes and never uses response error text', async () => {
  const { api, native, wait, context } = fixture()
  native.mockImplementation(async (operation) =>
    operation === 'secrets'
      ? { slots: [{ slot: 'readwise', origin: 'https://readwise.io', revision: 2 }] }
      : {
          status: 429,
          body: 'TOKEN must not be shown',
          headers: { 'retry-after': '2' },
          credentialRevision: 2,
          currentCredentialRevision: 2,
        },
  )
  await expect(api.scan('reader', context)).rejects.toThrow('HTTP 429')
  expect(wait).toHaveBeenCalledTimes(3)
  expect(wait).toHaveBeenCalledWith(2000, context.signal)
  native.mockImplementation(async (operation) =>
    operation === 'secrets'
      ? { slots: [{ slot: 'readwise', origin: 'https://readwise.io', revision: 2 }] }
      : { status: 200, body: '{}', credentialRevision: 2, currentCredentialRevision: 3 },
  )
  await expect(api.scan('reader', context)).rejects.toThrow('凭据已变更')
})
it('cancels waiting immediately and caps malformed retry-after values', async () => {
  const controller = new AbortController()
  const pending = abortableDelay(60_000, controller.signal)
  controller.abort()
  await expect(pending).rejects.toThrow()
  expect(retryDelay('999999')).toBe(120_000)
  expect(retryDelay('bad')).toBe(5000)
})
it('ignores late responses after cancellation', async () => {
  const { api, native } = fixture()
  const controller = new AbortController()
  native.mockImplementation(async (operation) => {
    if (operation === 'secrets')
      return { slots: [{ slot: 'readwise', origin: 'https://readwise.io', revision: 2 }] }
    controller.abort()
    return {
      status: 200,
      body: '{"results":[]}',
      credentialRevision: 2,
      currentCredentialRevision: 2,
    }
  })
  await expect(
    api.scan('reader', { signal: controller.signal, progress() {}, async yield() {} }),
  ).rejects.toThrow()
})
