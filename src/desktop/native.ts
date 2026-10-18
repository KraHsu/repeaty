import { invoke } from '@tauri-apps/api/core'
import type { ApiTransport } from '../backend/client'
export type DesktopConfig = { endpoint: string }
export const getConfig = () => invoke<DesktopConfig>('desktop_config')
export const setEndpoint = (endpoint: string) => invoke<void>('set_endpoint', { endpoint })
export function localPlugin<T>(id: string, operation: string, payload: unknown): Promise<T> {
  return invoke<T>('local_plugin', { id, operation, payload })
}
export const upstreamTransport: ApiTransport = async (path, init) => {
  init.signal?.throwIfAborted()
  const headers = new Headers(init.headers)
  let body: string | undefined
  if (init.body != null) {
    const bytes = new Uint8Array(await new Response(init.body).arrayBuffer())
    let binary = ''
    for (let i = 0; i < bytes.length; i += 32768)
      binary += String.fromCharCode(...bytes.subarray(i, i + 32768))
    body = btoa(binary)
  }
  const response = await invoke<{ status: number; contentType: string; body: string }>(
    'upstream_request',
    {
      request: {
        path,
        method: init.method ?? 'GET',
        contentType: headers.get('Content-Type'),
        userId: headers.get('X-Repeaty-User'),
        body,
      },
    },
  )
  init.signal?.throwIfAborted()
  return new Response(
    response.status === 204 ? null : Uint8Array.from(atob(response.body), (c) => c.charCodeAt(0)),
    { status: response.status, headers: { 'Content-Type': response.contentType } },
  )
}
export function handleExternalLinks() {
  document.addEventListener(
    'click',
    (event) => {
      const link = (event.target as Element).closest<HTMLAnchorElement>('a[href]')
      if (!link || !/^https?:/.test(link.href)) return
      event.preventDefault()
      void invoke('open_external', { url: link.href }).catch(() => {
        /* Native opener reports failure without navigating the app. */
      })
    },
    true,
  )
}
