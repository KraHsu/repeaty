import { z } from 'zod'
import type { Request, Site } from './request'

/** Only generic host capabilities cross the boundary; protocol rules belong to this plugin. */
export type NativeHost = (operation: string, payload: unknown) => Promise<unknown>

const sites = ['leetcode.cn', 'leetcode.com'] as const
const site = z.enum(sites)
const slug = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[a-z0-9-]+$/)
const number = z.string().min(1).max(30).regex(/^\d+$/)
const language = z
  .string()
  .min(1)
  .max(40)
  .regex(/^[a-zA-Z0-9-]+$/)
const code = z
  .string()
  .refine((value) => value.trim().length > 0 && new TextEncoder().encode(value).length <= 200_000)
const submission = { site, slug, questionId: number, lang: language, code }
const requestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('ping') }).strict(),
  z.object({ action: z.literal('account'), site }).strict(),
  z.object({ action: z.literal('question'), site, slug }).strict(),
  z.object({ action: z.literal('submit'), ...submission }).strict(),
  z.object({ action: z.literal('check'), site, submissionId: number }).strict(),
  z
    .object({
      action: z.literal('recover'),
      ...submission,
      submissionId: number,
      submittedAt: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    })
    .strict(),
])
const cookie = z
  .string()
  .min(1)
  .max(8192)
  .regex(/^[\x21-\x3a\x3c-\x7e]+$/)
const credentialSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('save'), site, session: cookie, csrf: cookie }).strict(),
  z.object({ action: z.literal('clear'), site }).strict(),
])
const secretsSchema = z.object({
  slots: z.array(
    z.object({ slot: z.string(), origin: z.string(), revision: z.number().int().nonnegative() }),
  ),
})
const responseSchema = z.object({
  status: z.number().int().min(100).max(599),
  body: z.string(),
  credentialRevision: z.number().int().nonnegative().nullable(),
  currentCredentialRevision: z.number().int().nonnegative().nullable(),
})

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (!result.success) throw 'invalid-data'
  return result.data
}
function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}
function accountStatus(value: unknown, site: Site) {
  const user = object(object(value).data).userStatus
  const status = object(user)
  if (status.isSignedIn === false) return { site, state: 'expired' }
  if (
    status.isSignedIn !== true ||
    typeof status.username !== 'string' ||
    !status.username.trim() ||
    Array.from(status.username).length > 200 ||
    /[\p{Cc}]/u.test(status.username)
  )
    throw 'invalid-response'
  return { site, state: 'authenticated', username: status.username }
}
function requestParts(request: Exclude<Request, { action: 'ping' }>) {
  switch (request.action) {
    case 'account':
      return {
        path: '/graphql/',
        body: { query: 'query RepeatyAccount { userStatus { isSignedIn username } }' },
      }
    case 'question': {
      const translated = request.site === 'leetcode.cn' ? 'translatedTitle translatedContent' : ''
      return {
        path: '/graphql/',
        body: {
          query: `query RepeatyQuestion($slug: String!) { question(titleSlug: $slug) { questionId questionFrontendId title titleSlug content ${translated} difficulty isPaidOnly codeSnippets { lang langSlug code } } }`,
          variables: { slug: request.slug },
        },
      }
    }
    case 'submit':
      return {
        path: `/problems/${request.slug}/submit/`,
        body: { lang: request.lang, question_id: request.questionId, typed_code: request.code },
      }
    case 'check':
      return { path: `/submissions/detail/${request.submissionId}/check/`, body: undefined }
    case 'recover': {
      const chinese = request.site === 'leetcode.cn'
      const id = chinese ? request.submissionId : Number(request.submissionId)
      if (!chinese && !Number.isSafeInteger(id)) throw 'invalid-data'
      return {
        path: '/graphql/',
        body: {
          query: chinese
            ? 'query RepeatyRecovery($submissionId: ID!) { submission: submissionDetail(submissionId: $submissionId) { code timestamp isMine lang question { questionId titleSlug } } }'
            : 'query RepeatyRecovery($submissionId: Int!) { submission: submissionDetails(submissionId: $submissionId) { code timestamp lang { name } question { questionId titleSlug } user { username } } userStatus { isSignedIn username } }',
          variables: { submissionId: id },
        },
      }
    }
  }
}
function verifySubmission(value: unknown, request: Extract<Request, { action: 'recover' }>) {
  const data = object(object(value).data)
  if (data.submission == null) throw 'submission-unavailable'
  const submission = object(data.submission)
  const current = object(data.userStatus)
  const owned =
    request.site === 'leetcode.cn'
      ? submission.isMine === true
      : current.isSignedIn === true &&
        typeof current.username === 'string' &&
        current.username.length > 0 &&
        object(submission.user).username === current.username
  if (!owned) throw 'submission-not-owned'
  const language = request.site === 'leetcode.cn' ? submission.lang : object(submission.lang).name
  const timestamp =
    typeof submission.timestamp === 'number'
      ? submission.timestamp
      : typeof submission.timestamp === 'string' && /^\d+$/.test(submission.timestamp)
        ? Number(submission.timestamp)
        : undefined
  const question = object(submission.question)
  if (
    question.titleSlug !== request.slug ||
    question.questionId !== request.questionId ||
    language !== request.lang ||
    typeof submission.code !== 'string' ||
    submission.code.replaceAll('\r\n', '\n') !== request.code.replaceAll('\r\n', '\n') ||
    !Number.isSafeInteger(timestamp) ||
    timestamp! < 0 ||
    Math.abs(timestamp! - request.submittedAt) > 300
  )
    throw 'submission-mismatch'
}

export function createLeetCodeBackend(native: NativeHost) {
  let submitting = false
  async function state() {
    const value = secretsSchema.safeParse(await native('secrets', { action: 'state' }))
    if (!value.success) throw 'invalid-response'
    return value.data.slots.filter(
      (entry) => sites.includes(entry.slot as Site) && entry.origin === `https://${entry.slot}`,
    )
  }
  async function configured() {
    const slots = await state()
    return sites.filter((site) => slots.some((entry) => entry.slot === site))
  }
  async function configure(input: unknown) {
    const request = parse(credentialSchema, input)
    const result = secretsSchema.safeParse(
      await native('secrets', {
        action: request.action === 'save' ? 'set' : 'clear',
        slot: request.site,
        ...(request.action === 'save'
          ? {
              origin: `https://${request.site}`,
              values: { session: request.session, csrf: request.csrf },
            }
          : {}),
      }),
    )
    if (!result.success) throw 'invalid-response'
    return {
      configured: sites.filter((site) =>
        result.data.slots.some(
          (entry) => entry.slot === site && entry.origin === `https://${site}`,
        ),
      ),
    }
  }
  async function request(input: unknown): Promise<unknown> {
    const request: Request = parse(requestSchema, input)
    if (request.action === 'ping') return { version: 1, configured: await configured() }
    const parts = requestParts(request)
    const initial = (await state()).find((entry) => entry.slot === request.site)
    const account = request.action === 'account'
    const submit = request.action === 'submit'
    if (account && !initial) return { site: request.site, state: 'unconfigured' }
    if ((submit || request.action === 'recover') && !initial) throw 'leetcode-not-configured'
    if (submit && submitting) throw 'submission-busy'
    if (submit) submitting = true
    let usedRevision = initial?.revision ?? null
    let currentRevision = usedRevision
    try {
      let value: unknown
      try {
        const raw = responseSchema.safeParse(
          await native('http', {
            url: `https://${request.site}${parts.path}`,
            method: parts.body === undefined ? 'GET' : 'POST',
            headers: {
              Referer: `https://${request.site}/`,
              'User-Agent': 'Mozilla/5.0 Repeaty/0.6',
              ...(parts.body === undefined ? {} : { 'Content-Type': 'application/json' }),
            },
            ...(parts.body === undefined ? {} : { body: JSON.stringify(parts.body) }),
            ...(initial
              ? {
                  secret: {
                    slot: request.site,
                    expectedRevision: initial.revision,
                    headers: {
                      Cookie: 'LEETCODE_SESSION={{session}}; csrftoken={{csrf}}',
                      'X-CSRFToken': '{{csrf}}',
                    },
                  },
                }
              : {}),
          }),
        )
        if (!raw.success) throw submit ? 'submission-unknown' : 'invalid-response'
        const response = raw.data
        usedRevision = response.credentialRevision
        currentRevision = response.currentCredentialRevision
        if (response.status < 200 || response.status >= 300)
          throw response.status === 401
            ? 'login-required'
            : response.status === 403
              ? 'verification-required'
              : response.status === 429
                ? 'rate-limit'
                : submit
                  ? 'submission-unknown'
                  : 'request-failed'
        if (new TextEncoder().encode(response.body).length > 1_000_000)
          throw submit ? 'submission-unknown' : 'invalid-response'
        try {
          value = JSON.parse(response.body)
        } catch {
          throw submit ? 'submission-unknown' : 'invalid-response'
        }
        const result = object(value)
        if (
          !(
            result.errors == null ||
            (Array.isArray(result.errors) && result.errors.length === 0)
          ) ||
          result.error != null
        )
          throw submit ? 'submission-unknown' : 'request-failed'
      } catch (issue) {
        let error =
          typeof issue === 'string' ? issue : submit ? 'submission-unknown' : 'request-failed'
        if (error === 'plugin-network-error')
          error = submit ? 'submission-unknown' : 'request-failed'
        if (error === 'plugin-response-limit' || error === 'invalid-response')
          error = submit ? 'submission-unknown' : 'invalid-response'
        if (error === 'credential-unavailable') error = 'credentials-changed'
        if (account || error === 'login-required' || error === 'verification-required') {
          const current =
            (await state()).find((entry) => entry.slot === request.site)?.revision ?? null
          if (current !== usedRevision || currentRevision !== usedRevision)
            throw 'credentials-changed'
        }
        if (account && error === 'login-required') return { site: request.site, state: 'expired' }
        throw error
      }
      if (account) {
        const current =
          (await state()).find((entry) => entry.slot === request.site)?.revision ?? null
        if (
          current !== usedRevision ||
          currentRevision !== usedRevision ||
          usedRevision !== initial?.revision
        )
          throw 'credentials-changed'
        return accountStatus(value, request.site)
      }
      if (request.action === 'recover') {
        verifySubmission(value, request)
        return { submissionId: request.submissionId }
      }
      return value
    } finally {
      if (submit) submitting = false
    }
  }
  return { request, configure }
}
