import type { Connection, Native } from './types'
import { record } from './util'
export class RemoteRejected extends Error {
  constructor(readonly status: number) {
    super(`remote-http-${status}`)
  }
}
/** A mutation may already have succeeded; failures in follow-up reads are never safe create retries. */
export class PartialMutation extends Error {
  constructor() {
    super('remote-result-unknown')
  }
}
export function responseError(status: number): Error {
  return [400, 401, 403, 404, 405, 409, 412, 413, 415, 422, 429].includes(status)
    ? new RemoteRejected(status)
    : new Error(`remote-http-${status}`)
}

export function createTransport(native: Native, connection: Connection) {
  let credentialRevision: number | undefined
  async function request(
    path: string,
    method: string,
    signal: AbortSignal,
    data?: unknown,
    xml?: string,
  ) {
    signal.throwIfAborted()
    const url = new URL(`${connection.site}${path}`)
    if (url.origin !== new URL(connection.site).origin) throw new Error('invalid-site')
    if (credentialRevision === undefined) {
      const state = record(await native('secrets', { action: 'state' }))
      const slot = Array.isArray(state.slots)
        ? state.slots
            .map(record)
            .find((item) => item.slot === connection.slot && item.origin === url.origin)
        : undefined
      if (!slot || typeof slot.revision !== 'number') throw new Error('credential-unavailable')
      credentialRevision = slot.revision
    }
    signal.throwIfAborted()
    const requestId = crypto.randomUUID()
    const stop = () => {
      void native('http.cancel', { requestId }).catch(() => undefined)
    }
    signal.addEventListener('abort', stop, { once: true })
    try {
      const result = record(
        await native(
          'http',
          {
            requestId,
            url: url.href,
            method,
            headers: { 'Content-Type': xml ? 'text/xml; charset=utf-8' : 'application/json' },
            ...(data === undefined ? {} : { body: JSON.stringify(data) }),
            secret: {
              slot: connection.slot,
              expectedRevision: credentialRevision,
              ...(xml
                ? { body: { template: xml, encoding: 'xml' } }
                : {
                    headers:
                      connection.adapter === 'user-api'
                        ? { 'User-Api-Key': '{{key}}' }
                        : { Authorization: '{{authorization}}' },
                  }),
            },
          },
          signal,
        ),
      )
      signal.throwIfAborted()
      if (
        result.credentialRevision !== credentialRevision ||
        result.currentCredentialRevision !== credentialRevision
      )
        throw new Error('credentials-changed')
      if (typeof result.status !== 'number' || typeof result.body !== 'string')
        throw new Error('invalid-response')
      return { status: result.status, body: result.body, headers: record(result.headers) }
    } finally {
      signal.removeEventListener('abort', stop)
    }
  }
  return {
    request,
    async json(path: string, method: string, signal: AbortSignal, data?: unknown) {
      const result = await request(path, method, signal, data)
      if (result.status === 404 && method === 'GET') return null
      if (result.status < 200 || result.status >= 300) throw responseError(result.status)
      try {
        return result.body ? (JSON.parse(result.body) as unknown) : {}
      } catch {
        throw new Error('invalid-response')
      }
    },
  }
}
