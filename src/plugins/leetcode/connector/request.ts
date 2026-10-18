import type { Request } from './protocol.js'

/** Serialized by chrome.scripting; this function must not close over module variables. */
export async function requestOnLeetCode(request: Exclude<Request, { action: 'ping' }>) {
  if (location.origin !== `https://${request.site}`) return { ok: false, error: 'wrong-site' }
  let path: string
  let body: string | undefined
  if (request.action === 'question') {
    path = '/graphql/'
    const translated = request.site === 'leetcode.cn' ? 'translatedTitle translatedContent' : ''
    body = JSON.stringify({
      query: `query RepeatyQuestion($slug: String!) { question(titleSlug: $slug) { questionId questionFrontendId title titleSlug content ${translated} difficulty isPaidOnly codeSnippets { lang langSlug code } } }`,
      variables: { slug: request.slug },
    })
  } else if (request.action === 'submit') {
    path = `/problems/${request.slug}/submit/`
    body = JSON.stringify({
      lang: request.lang,
      question_id: request.questionId,
      typed_code: request.code,
    })
  } else path = `/submissions/detail/${request.submissionId}/check/`
  const csrf = document.cookie
    .split(';')
    .map((item) => item.trim())
    .find((item) => item.startsWith('csrftoken='))
    ?.slice('csrftoken='.length)
  if (request.action === 'submit' && !csrf) return { ok: false, error: 'login-required' }
  try {
    const response = await fetch(path, {
      method: body ? 'POST' : 'GET',
      body,
      credentials: 'same-origin',
      redirect: 'error',
      headers: {
        'Content-Type': 'application/json',
        ...(csrf ? { 'X-CSRFToken': decodeURIComponent(csrf) } : {}),
      },
      signal: AbortSignal.timeout(20000),
    })
    if (!response.ok)
      return {
        ok: false,
        error:
          response.status === 429
            ? 'rate-limit'
            : [401, 403].includes(response.status)
              ? 'login-required'
              : 'request-failed',
      }
    const text = await response.text()
    if (text.length > 1000000) return { ok: false, error: 'invalid-response' }
    const data = JSON.parse(text)
    if (data.errors || data.error) return { ok: false, error: 'request-failed' }
    return { ok: true, data }
  } catch {
    return {
      ok: false,
      error: request.action === 'submit' ? 'submission-unknown' : 'request-failed',
    }
  }
}
