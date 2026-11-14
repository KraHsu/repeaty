export interface PluginHttpSecret {
  slot: string
  expectedRevision?: number
  headers?: Record<string, string>
  body?: { template: string; encoding: 'xml' }
}
export type PluginHttpBody =
  | string
  | { base64: string }
  | {
      multipart: (
        | { name: string; text: string }
        | { name: string; base64: string; filename: string; type: string }
      )[]
    }
export interface PluginHttpRequest {
  url: string
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS'
  headers?: Record<string, string>
  body?: PluginHttpBody
  secret?: PluginHttpSecret
}
export interface PluginHttpResponse {
  status: number
  headers: Record<string, string>
  body: string
  credentialRevision: number | null
  currentCredentialRevision: number | null
}
export declare const network: {
  /** Host-owned confirmation, HTTPS origin only; requires manifest network:true.
   * Grant lasts for this plugin activation/current library, not the saved configuration.
   */
  authorize(origin: string): Promise<void>
  /** Native transport. Cancellation does not imply a remote write was rolled back. */
  request(input: PluginHttpRequest, signal?: AbortSignal): Promise<PluginHttpResponse>
}
