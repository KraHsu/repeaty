export type Native = (operation: string, payload: unknown, signal?: AbortSignal) => Promise<unknown>
export type Provider = 'wordpress' | 'discourse'
export interface Connection {
  site: string
  adapter: 'rest' | 'xmlrpc' | 'user-api'
  blogId?: string
  slot: string
}
export interface Draft {
  sourceId: string
  versionId: string
  title: string
  content: string
  status: 'draft' | 'publish' | 'private'
  category: string
  tags: string[]
}
export interface Remote {
  id: string
  topicId?: string
  url: string
  title: string
  content: string
  status: string
  category: string
  tags: string[]
  revision: string
}
export interface Catalog {
  categories: { id: string; name: string }[]
  tags: { id: string; name: string }[]
}
export interface Adapter {
  provider: Provider
  connection: Connection
  verify(signal: AbortSignal): Promise<void>
  catalog(signal: AbortSignal): Promise<Catalog>
  find(marker: string, signal: AbortSignal): Promise<Remote | null>
  read(id: string, signal: AbortSignal): Promise<Remote | null>
  create(draft: Draft, marker: string, signal: AbortSignal): Promise<Remote>
  update(remote: Remote, draft: Draft, marker: string, signal: AbortSignal): Promise<Remote>
  remove(remote: Remote, signal: AbortSignal): Promise<void>
}
export interface Binding {
  sourceId: string
  site: string
  adapter: string
  marker: string
  remote?: Remote
  state: 'ready' | 'pending' | 'unknown' | 'deleted'
  pending?: { id: string; action: 'create' | 'update' | 'delete'; fingerprint: string; at: string }
  sourceVersion?: string
}
export interface Ledger {
  version: 1
  bindings: Record<string, Binding>
}
export interface Preview {
  connection: Connection
  draft: Draft
  marker: string
  previous: Remote | null
  fingerprint: string
  action: 'create' | 'update' | 'delete'
  at: number
}
export interface Store {
  load(): Promise<Ledger>
  save(value: Ledger): Promise<void>
}
