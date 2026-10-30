import { siteUrl, utf8Base64 } from '@repeaty/publishing-client'

interface Pending {
  privateKey: CryptoKey
  nonce: string
  site: string
  expires: number
}
/** A single page owns this exchange. Private keys never enter plugin data or device settings. */
export function createAuthorization() {
  let pending: Pending | undefined
  let generation = 0
  function clear() {
    generation++
    pending = undefined
  }
  async function begin(site: string) {
    clear()
    const epoch = generation
    const normalized = siteUrl(site)
    const pair = await crypto.subtle.generateKey(
      {
        name: 'RSA-OAEP',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-1',
      },
      false,
      ['encrypt', 'decrypt'],
    )
    const bytes = new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey))
    const publicKey = `-----BEGIN PUBLIC KEY-----\n${btoa(String.fromCharCode(...bytes))
      .match(/.{1,64}/g)!
      .join('\n')}\n-----END PUBLIC KEY-----`
    const nonce = [...crypto.getRandomValues(new Uint8Array(24))]
      .map((x) => x.toString(16).padStart(2, '0'))
      .join('')
    if (generation !== epoch) throw new Error('authorization-cancelled')
    pending = {
      privateKey: pair.privateKey,
      nonce,
      site: normalized,
      expires: Date.now() + 15 * 60_000,
    }
    const url = new URL(`${normalized}/user-api-key/new`)
    url.searchParams.set('application_name', 'Repeaty')
    url.searchParams.set('client_id', utf8Base64(`repeaty-${crypto.randomUUID()}`))
    url.searchParams.set('scopes', 'read,write')
    url.searchParams.set('padding', 'oaep')
    url.searchParams.set('nonce', nonce)
    url.searchParams.set('public_key', publicKey)
    // No redirect is needed: Discourse displays the encrypted result for the user to copy.
    return url.href
  }
  async function complete(site: string, payload: string) {
    const value = pending
    const epoch = generation
    if (!value || Date.now() > value.expires || value.site !== siteUrl(site))
      throw new Error('authorization-expired')
    if (!/^[A-Za-z0-9+/=\r\n]{1,8192}$/.test(payload.trim()))
      throw new Error('authorization-invalid')
    let raw: Uint8Array
    try {
      const ciphertext = Uint8Array.from(atob(payload.trim()), (character) =>
        character.charCodeAt(0),
      )
      raw = new Uint8Array(
        await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, value.privateKey, ciphertext),
      )
    } catch {
      throw new Error('authorization-invalid')
    }
    try {
      const result = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)) as {
        nonce?: unknown
        key?: unknown
      }
      if (generation !== epoch || pending !== value) throw new Error('authorization-cancelled')
      if (
        result.nonce !== value.nonce ||
        typeof result.key !== 'string' ||
        !/^[\x21-\x7e]{8,4096}$/.test(result.key)
      )
        throw new Error('authorization-invalid')
      clear()
      return result.key
    } finally {
      raw.fill(0)
    }
  }
  return { begin, complete, clear }
}
