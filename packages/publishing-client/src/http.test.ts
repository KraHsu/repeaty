import { expect, it, vi } from 'vitest'
import { createTransport } from './http'
import type { Connection } from './types'
const connection: Connection = { site: 'https://site.example', adapter: 'rest', slot: 'account' }
const state = { slots: [{ slot: 'account', origin: 'https://site.example', revision: 4 }] }
it('uses device credential templates and rejects changed credentials without exposing body text', async () => {
  const native = vi.fn(async (operation: string) =>
    operation === 'secrets'
      ? state
      : {
          status: 401,
          body: 'sensitive server error',
          headers: {},
          credentialRevision: 4,
          currentCredentialRevision: 4,
        },
  )
  await expect(
    createTransport(native, connection).json(
      '/wp-json/wp/v2/posts',
      'GET',
      new AbortController().signal,
    ),
  ).rejects.toThrow('remote-http-401')
  expect(native.mock.calls[1]?.[0]).toBe('http')
  native.mockImplementation(async (operation: string) =>
    operation === 'secrets'
      ? state
      : {
          status: 200,
          body: '{}',
          headers: {},
          credentialRevision: 4,
          currentCredentialRevision: 5,
        },
  )
  await expect(
    createTransport(native, connection).json('/posts', 'GET', new AbortController().signal),
  ).rejects.toThrow('credentials-changed')
})
it('cancels the native request when the view aborts and drops its late response', async () => {
  let finish!: (value: unknown) => void
  const native = vi.fn(async (operation: string) =>
    operation === 'secrets'
      ? state
      : operation === 'http.cancel'
        ? null
        : new Promise((resolve) => {
            finish = resolve
          }),
  )
  const controller = new AbortController()
  const pending = createTransport(native, connection).json('/posts', 'GET', controller.signal)
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
  controller.abort()
  finish({
    status: 200,
    body: '{}',
    headers: {},
    credentialRevision: 4,
    currentCredentialRevision: 4,
  })
  await expect(pending).rejects.toThrow()
  expect(native.mock.calls.some(([operation]) => operation === 'http.cancel')).toBe(true)
})
