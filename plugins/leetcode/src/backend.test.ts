import { expect, it, vi } from 'vitest'
import { createLeetCodeBackend, type NativeHost } from './backend'
import type { Request } from './request'

function fixture(configured = true) {
  let revision = 1
  const slots = new Map<string, { slot: string; origin: string; revision: number }>()
  if (configured)
    slots.set('leetcode.cn', {
      slot: 'leetcode.cn',
      origin: 'https://leetcode.cn',
      revision,
    })
  const response = (value: unknown, status = 200, used = 1, current: number | null = used) => ({
    status,
    body: JSON.stringify(value),
    headers: { 'content-type': 'application/json' },
    credentialRevision: used,
    currentCredentialRevision: current,
  })
  const http = vi.fn(async (_payload: Record<string, unknown>) => response({ submission_id: 123 }))
  const host = vi.fn<NativeHost>(async (operation, payload) => {
    const input = payload as Record<string, unknown>
    if (operation === 'http') return http(input)
    expect(operation).toBe('secrets')
    if (input.action === 'set') {
      revision++
      slots.set(input.slot as string, {
        slot: input.slot as string,
        origin: input.origin as string,
        revision,
      })
    } else if (input.action === 'clear') {
      revision++
      slots.delete(input.slot as string)
    }
    return { slots: Array.from(slots.values()) }
  })
  return { backend: createLeetCodeBackend(host), host, http, response, slots }
}
const submit: Request = {
  action: 'submit',
  site: 'leetcode.cn',
  slug: 'two-sum',
  questionId: '1',
  lang: 'python3',
  code: 'return 1',
}
const recover = {
  ...submit,
  action: 'recover' as const,
  submissionId: '123',
  submittedAt: 1_700_000_000,
}
function submission() {
  return {
    code: 'return 1',
    timestamp: '1700000000',
    isMine: true,
    lang: 'python3',
    question: { questionId: '1', titleSlug: 'two-sum' },
  }
}

it('rejects untrusted operation fields, sites and malformed identifiers before native access', async () => {
  const { backend, host } = fixture()
  for (const request of [
    { action: 'ping', credentials: true },
    { ...submit, site: 'evil.test' },
    { ...submit, slug: '../secret' },
    { ...submit, questionId: '1/2' },
    { ...submit, lang: 'python 3' },
    { ...submit, code: ' ' },
    { ...submit, code: '中'.repeat(70_000) },
    { action: 'check', site: 'leetcode.cn', submissionId: '-1' },
    { ...recover, submittedAt: 0 },
    { ...recover, site: 'leetcode.com', submissionId: '999999999999999999999999999999' },
    { action: 'shell', command: 'anything' },
  ])
    await expect(backend.request(request)).rejects.toBe('invalid-data')
  expect(host).not.toHaveBeenCalled()
})

it('configures independent site slots without reading saved secrets or accepting header injection', async () => {
  const { backend, host } = fixture(false)
  expect(await backend.request({ action: 'ping' })).toEqual({ version: 1, configured: [] })
  for (const site of ['leetcode.cn', 'leetcode.com'])
    await backend.configure({ action: 'save', site, session: 'session', csrf: 'csrf' })
  expect(await backend.request({ action: 'ping' })).toEqual({
    version: 1,
    configured: ['leetcode.cn', 'leetcode.com'],
  })
  expect(await backend.configure({ action: 'clear', site: 'leetcode.cn' })).toEqual({
    configured: ['leetcode.com'],
  })
  const before = host.mock.calls.length
  for (const value of ['', 'bad;cookie', 'bad\r\nheader', 'with space', 'x'.repeat(8193)])
    await expect(
      backend.configure({ action: 'save', site: 'leetcode.com', session: value, csrf: 'csrf' }),
    ).rejects.toBe('invalid-data')
  await expect(backend.configure({ action: 'clear', site: 'evil.test' })).rejects.toBe(
    'invalid-data',
  )
  expect(host.mock.calls).toHaveLength(before)
  expect(host.mock.calls.every(([operation]) => operation === 'secrets')).toBe(true)
})

it('reads public questions without credentials and only sends fixed site queries', async () => {
  const { backend, http, response } = fixture(false)
  http.mockImplementation(async () => response({ data: { question: { title: 'Two Sum' } } }))
  for (const site of ['leetcode.cn', 'leetcode.com']) {
    await backend.request({ action: 'question', site, slug: 'two-sum' })
    const payload = http.mock.calls.at(-1)![0]
    expect(payload.url).toBe(`https://${site}/graphql/`)
    expect(payload.method).toBe('POST')
    expect(payload).not.toHaveProperty('secret')
    const body = JSON.parse(payload.body as string)
    expect(body.variables).toEqual({ slug: 'two-sum' })
    expect(body.query.includes('translatedContent')).toBe(site === 'leetcode.cn')
  }
})

it('keeps unconfigured accounts separate from expired sessions and refuses unconfigured submissions', async () => {
  const { backend, http } = fixture(false)
  expect(await backend.request({ action: 'account', site: 'leetcode.cn' })).toEqual({
    site: 'leetcode.cn',
    state: 'unconfigured',
  })
  await expect(backend.request(submit)).rejects.toBe('leetcode-not-configured')
  await expect(backend.request(recover)).rejects.toBe('leetcode-not-configured')
  expect(http).not.toHaveBeenCalled()
})

it('requires explicit authenticated account data and exposes only a bounded username', async () => {
  const { backend, http, response } = fixture()
  const check = () => backend.request({ action: 'account', site: 'leetcode.cn' })
  http.mockImplementation(async () =>
    response({
      data: { userStatus: { isSignedIn: true, username: 'learner', ignored: 'private' } },
    }),
  )
  expect(await check()).toEqual({
    site: 'leetcode.cn',
    state: 'authenticated',
    username: 'learner',
  })
  http.mockImplementation(async () => response({ data: { userStatus: { isSignedIn: false } } }))
  expect(await check()).toEqual({ site: 'leetcode.cn', state: 'expired' })
  for (const username of ['', ' ', 'x'.repeat(201), 'bad\nname', undefined]) {
    http.mockImplementation(async () =>
      response({ data: { userStatus: { isSignedIn: true, username } } }),
    )
    await expect(check()).rejects.toBe('invalid-response')
  }
  http.mockImplementation(async () => response({ data: {} }))
  await expect(check()).rejects.toBe('invalid-response')
})

it('distinguishes authentication, verification, rate limits and unknown submit results', async () => {
  const { backend, http, response } = fixture()
  for (const [status, code] of [
    [401, 'login-required'],
    [403, 'verification-required'],
    [429, 'rate-limit'],
    [500, 'submission-unknown'],
    [302, 'submission-unknown'],
  ] as const) {
    http.mockImplementation(async () => response({}, status))
    await expect(backend.request(submit)).rejects.toBe(code)
  }
  http.mockImplementation(async () => response({}, 401))
  expect(await backend.request({ action: 'account', site: 'leetcode.cn' })).toEqual({
    site: 'leetcode.cn',
    state: 'expired',
  })
  http.mockImplementation(async () => response({}, 500))
  await expect(
    backend.request({ action: 'check', site: 'leetcode.cn', submissionId: '123' }),
  ).rejects.toBe('request-failed')
})

it('never retries malformed or interrupted submissions and releases the submission lock', async () => {
  const { backend, http, response } = fixture()
  for (const value of [
    { ...response({}), body: '<html>verification</html>' },
    { ...response({}), body: 'x'.repeat(1_000_001) },
    response({ errors: [{ message: 'failed' }] }),
    response({ error: 'failed' }),
  ]) {
    http.mockImplementation(async () => value)
    const before = http.mock.calls.length
    await expect(backend.request(submit)).rejects.toBe('submission-unknown')
    expect(http.mock.calls.length).toBe(before + 1)
  }
  for (const issue of [
    new Error('connection reset'),
    'plugin-network-error',
    'plugin-response-limit',
    'invalid-response',
  ]) {
    http.mockImplementation(async () => {
      throw issue
    })
    const before = http.mock.calls.length
    await expect(backend.request(submit)).rejects.toBe('submission-unknown')
    expect(http.mock.calls.length).toBe(before + 1)
  }
  http.mockImplementation(async () => response({ submission_id: 123 }))
  expect(await backend.request(submit)).toEqual({ submission_id: 123 })
})

it('rejects concurrent submits and preserves the result of the first acknowledged request', async () => {
  const { backend, http, response } = fixture()
  let finish!: (value: ReturnType<typeof response>) => void
  http.mockImplementation(() => new Promise((resolve) => (finish = resolve)))
  const first = backend.request(submit)
  await vi.waitFor(() => expect(http).toHaveBeenCalledTimes(1))
  await expect(backend.request(submit)).rejects.toBe('submission-busy')
  finish(response({ submission_id: 123 }))
  expect(await first).toEqual({ submission_id: 123 })
  expect(http.mock.calls[0]![0]).toMatchObject({
    url: 'https://leetcode.cn/problems/two-sum/submit/',
    method: 'POST',
    secret: { slot: 'leetcode.cn', expectedRevision: 1 },
  })
  expect(JSON.parse(http.mock.calls[0]![0].body as string)).toEqual({
    lang: 'python3',
    question_id: '1',
    typed_code: 'return 1',
  })
})

it('rejects late account and authentication errors after credentials change but retains successful submit ids', async () => {
  const { backend, http, response, slots } = fixture()
  http.mockImplementation(async () => {
    slots.delete('leetcode.cn')
    return response(
      { data: { userStatus: { isSignedIn: true, username: 'old-account' } } },
      200,
      1,
      null,
    )
  })
  await expect(backend.request({ action: 'account', site: 'leetcode.cn' })).rejects.toBe(
    'credentials-changed',
  )
  slots.set('leetcode.cn', { slot: 'leetcode.cn', origin: 'https://leetcode.cn', revision: 3 })
  http.mockImplementation(async () => response({}, 401, 1, 3))
  await expect(backend.request(submit)).rejects.toBe('credentials-changed')
  http.mockImplementation(async () => response({ submission_id: 456 }, 200, 1, 3))
  expect(await backend.request(submit)).toEqual({ submission_id: 456 })
  http.mockImplementation(async () => {
    throw 'credential-unavailable'
  })
  await expect(backend.request(submit)).rejects.toBe('credentials-changed')
})

it('recovers only the current account submission matching all immutable question, code and time fields', async () => {
  const { backend, http, response } = fixture()
  http.mockImplementation(async () => response({ data: { submission: submission() } }))
  expect(await backend.request(recover)).toEqual({ submissionId: '123' })
  expect(JSON.parse(http.mock.calls.at(-1)![0].body as string).variables).toEqual({
    submissionId: '123',
  })
  for (const changed of [
    { isMine: false },
    { lang: 'javascript' },
    { question: { questionId: '2', titleSlug: 'two-sum' } },
    { question: { questionId: '1', titleSlug: 'other' } },
    { code: 'return 2' },
    { timestamp: '1700000301' },
    { timestamp: -1 },
    { timestamp: 'not-a-date' },
  ]) {
    http.mockImplementation(async () =>
      response({ data: { submission: { ...submission(), ...changed } } }),
    )
    await expect(backend.request(recover)).rejects.toBe(
      'isMine' in changed ? 'submission-not-owned' : 'submission-mismatch',
    )
  }
  http.mockImplementation(async () => response({ data: { submission: null } }))
  await expect(backend.request(recover)).rejects.toBe('submission-unavailable')
  http.mockImplementation(async () =>
    response({
      data: { submission: { ...submission(), timestamp: 1_700_000_300, code: 'return\r\n1' } },
    }),
  )
  expect(await backend.request({ ...recover, code: 'return\n1' })).toEqual({ submissionId: '123' })
})

it('checks international ownership and uses an integer id only where its query requires it', async () => {
  const { backend, http, response, slots } = fixture()
  slots.set('leetcode.com', { slot: 'leetcode.com', origin: 'https://leetcode.com', revision: 1 })
  const data = {
    submission: { ...submission(), lang: { name: 'python3' }, user: { username: 'learner' } },
    userStatus: { isSignedIn: true, username: 'learner' },
  }
  http.mockImplementation(async () => response({ data }))
  expect(await backend.request({ ...recover, site: 'leetcode.com' })).toEqual({
    submissionId: '123',
  })
  expect(JSON.parse(http.mock.calls.at(-1)![0].body as string).variables).toEqual({
    submissionId: 123,
  })
  http.mockImplementation(async () =>
    response({ data: { ...data, userStatus: { isSignedIn: true, username: 'someone-else' } } }),
  )
  await expect(backend.request({ ...recover, site: 'leetcode.com' })).rejects.toBe(
    'submission-not-owned',
  )
})

it('uses a read-only fixed submission status endpoint', async () => {
  const { backend, http } = fixture()
  await backend.request({ action: 'check', site: 'leetcode.cn', submissionId: '123' })
  expect(http.mock.calls[0]![0]).toMatchObject({
    url: 'https://leetcode.cn/submissions/detail/123/check/',
    method: 'GET',
  })
  expect(http.mock.calls[0]![0]).not.toHaveProperty('body')
})
