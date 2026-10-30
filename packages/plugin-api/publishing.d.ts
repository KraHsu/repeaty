/** Explicit public projection. Internal identity is for local bindings, never template variables. */
export type PublishingField = string | number | boolean | string[]
export interface PublishingAsset {
  id: string
  reference: string
  type: string
  size: number
}
export interface PublishingSource {
  id: string
  versionId: string
  title: string
  body: string
  format: 'plain' | 'markdown'
  createdAt: string
  updatedAt: string
  fields: Record<string, PublishingField>
  assets: PublishingAsset[]
  /** Resolved references may target unselected materials; never includes their content or fields. */
  links: { reference: string; sourceId: string; fragment?: string }[]
}
export interface PublishingSnapshot {
  id: string
  workspaceScope: string
  revision: number
  createdAt: string
  sources: PublishingSource[]
}
export interface PublishingApi {
  /** Titles only, for the explicit material picker. No bodies, metadata values or private paths. */
  list(): {
    workspaceScope: string
    revision: number
    sources: { id: string; title: string; versionId: string }[]
  }
  /** Exact selected IDs (including an explicit empty selection); never silently includes descendants. Only named scalar fields are public.
   * Draft/private materials are rejected; frontmatter is stripped. Max 1000 materials / 32 MiB text.
   */
  prepare(
    input: { sourceIds: string[]; expectedRevision: number; publicFields?: string[] },
    signal?: AbortSignal,
  ): Promise<PublishingSnapshot>
  /** Revalidate before export/upload; edits, expiry, replacement, disposal and library changes fail. */
  validate(snapshotId: string): void
  /** Only attachment references found in this snapshot. Never arbitrary library media or originals. */
  asset(snapshotId: string, assetId: string, signal?: AbortSignal): Promise<Blob>
  release(snapshotId: string): void
}
export declare const publishing: PublishingApi

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
