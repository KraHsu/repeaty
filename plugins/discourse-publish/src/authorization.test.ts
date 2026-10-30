import { expect, it } from 'vitest'
import { createAuthorization } from './authorization'

async function encrypted(url: string, nonce?: string) {
  const params = new URL(url).searchParams
  const pem = params.get('public_key')!.replace(/-----[^-]+-----|\s/g, '')
  const key = await crypto.subtle.importKey(
    'spki',
    Uint8Array.from(atob(pem), (c) => c.charCodeAt(0)),
    { name: 'RSA-OAEP', hash: 'SHA-1' },
    false,
    ['encrypt'],
  )
  const bytes = await crypto.subtle.encrypt(
    { name: 'RSA-OAEP' },
    key,
    new TextEncoder().encode(
      JSON.stringify({ nonce: nonce ?? params.get('nonce'), key: 'user-key-private-123' }),
    ),
  )
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
}
it('performs the actual OAEP exchange and makes successful authorization single-use', async () => {
  const auth = createAuthorization()
  const url = await auth.begin('https://forum.example')
  expect(new URL(url).searchParams.get('padding')).toBe('oaep')
  expect(new URL(url).searchParams.get('scopes')).toBe('read,write')
  const payload = await encrypted(url)
  expect(await auth.complete('https://forum.example', payload)).toBe('user-key-private-123')
  await expect(auth.complete('https://forum.example', payload)).rejects.toThrow(
    'authorization-expired',
  )
})
it('rejects wrong nonce, changed site and cleared exchanges', async () => {
  const auth = createAuthorization()
  const url = await auth.begin('https://forum.example')
  await expect(
    auth.complete('https://forum.example', await encrypted(url, 'wrong')),
  ).rejects.toThrow('authorization-invalid')
  await expect(auth.complete('https://other.example', await encrypted(url))).rejects.toThrow(
    'authorization-expired',
  )
  auth.clear()
  await expect(auth.complete('https://forum.example', await encrypted(url))).rejects.toThrow(
    'authorization-expired',
  )
})
