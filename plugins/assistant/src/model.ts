export type ProviderKind = 'openai-compatible' | 'codex-app-server'
export interface ProviderProfile {
  id: string
  name: string
  kind: ProviderKind
  endpoint: string
  model: string
  reasoningEffort?: string
  executable?: string
  hasCredential?: boolean
}
export interface Attachment {
  id: string
  name: string
  mime: 'image/png' | 'image/jpeg' | 'image/webp'
  size: number
}
export interface ImageInput extends Attachment {
  data: string
}
export interface AssistantContext {
  label: string
  sourceIds: string[]
  folderIds: string[]
  collectionIds: string[]
  deckIds: string[]
  all: boolean
  selection: string
  revision?: string
}
export interface ToolCall {
  id: string
  name: string
  arguments: string
}
export interface ToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown>
}
export interface Proposal {
  id: string
  title: string
  preview: unknown
  status: 'pending' | 'applied' | 'rejected' | 'failed'
  receipt?: unknown
  error?: string
}
export interface Message {
  id: string
  role: 'user' | 'assistant' | 'tool'
  text: string
  createdAt: string
  images?: Attachment[]
  toolCalls?: ToolCall[]
  toolCallId?: string
  proposals?: Proposal[]
  status?: 'running' | 'complete' | 'interrupted' | 'failed'
}
export interface ThreadSummary {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  status: 'active' | 'archived' | 'deleted'
  providerId: string
  providerThreadId?: string
  continuedFrom?: string
}
export interface Thread extends ThreadSummary {
  messages: Message[]
  draft: string
  draftImages: Attachment[]
  context: AssistantContext
  error?: string
  contextUsage?: ContextUsage
}
export interface ContextUsage {
  messages: number
  totalMessages: number
  images: number
  totalImages: number
  clippedMessages: number
}
export interface ProviderMessage extends Omit<Message, 'images'> {
  images?: ImageInput[]
}
export interface ProviderRequest {
  requestId: string
  profile: ProviderProfile
  threadId?: string
  messages: ProviderMessage[]
  tools: ToolDefinition[]
  context: AssistantContext
  signal: AbortSignal
  contextNotice?: string
  /** For providers that keep a native turn open while awaiting dynamic tool results. */
  handleTool?: (call: ToolCall) => Promise<unknown>
}
export type ProviderEvent =
  | { type: 'delta'; text: string }
  | { type: 'thread'; threadId: string }
  | { type: 'status'; text: string }
export interface ProviderReply {
  text: string
  toolCalls: ToolCall[]
  threadId?: string
}
export interface Provider {
  complete(request: ProviderRequest, emit: (event: ProviderEvent) => void): Promise<ProviderReply>
}
export interface AssistantTools {
  definitions: ToolDefinition[]
  execute(
    call: ToolCall,
    context: AssistantContext,
    signal: AbortSignal,
  ): Promise<{ result: unknown; proposal?: Proposal }>
  apply(proposal: Proposal, context: AssistantContext, signal: AbortSignal): Promise<unknown>
}
export const emptyContext = (): AssistantContext => ({
  label: '',
  sourceIds: [],
  folderIds: [],
  collectionIds: [],
  deckIds: [],
  all: false,
  selection: '',
})
export const uid = () => crypto.randomUUID()

export class AssistantError extends Error {
  constructor(
    readonly code:
      | 'interrupted'
      | 'storage'
      | 'network'
      | 'authentication'
      | 'model'
      | 'protocol'
      | 'tool-limit'
      | 'scope'
      | 'stale'
      | 'unavailable',
    message?: string,
  ) {
    super(message ?? code)
  }
}

export function safeError(error: unknown): AssistantError['code'] {
  if (error instanceof AssistantError) return error.code
  if (error instanceof DOMException && error.name === 'AbortError') return 'interrupted'
  const code =
    error && typeof error === 'object' && 'code' in error
      ? error.code
      : error instanceof Error
        ? error.message
        : error
  if (code === 'library-changed' || code === 'stale-workspace-session') return 'stale'
  if (code === 'permission-denied' || code === 'scope-denied' || code === 'grant-required')
    return 'scope'
  if (code === 'cancelled' || code === 'aborted') return 'interrupted'
  if (code === 'model-auth-required') return 'authentication'
  if (code === 'model-cancelled' || code === 'model-activation-ended') return 'interrupted'
  if (
    code === 'model-timeout' ||
    code === 'model-network-error' ||
    code === 'model-stream-interrupted'
  )
    return 'network'
  if (code === 'model-storage-error') return 'storage'
  if (
    code === 'model-invalid-response' ||
    code === 'model-invalid-tool-call' ||
    code === 'model-stream-unsupported'
  )
    return 'protocol'
  if (typeof code === 'string' && code.startsWith('model-')) return 'model'
  // Provider bodies can contain access tokens or private material. Never persist arbitrary errors.
  return 'unavailable'
}
