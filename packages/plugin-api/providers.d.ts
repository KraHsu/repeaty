/** Device-local providers. Credentials are write-only and never copied into library data. */
export interface ModelProfile {
  id: string
  name: string
  kind: 'openai-compatible' | 'codex'
  endpoint?: string
  executable?: string
  defaultModel?: string
  hasCredential: boolean
}
export interface ModelProfileInput {
  id?: string
  name: string
  kind: ModelProfile['kind']
  endpoint?: string
  executable?: string
  defaultModel?: string
  /** Undefined preserves the saved credential; empty removes it. */
  apiKey?: string
}
export interface ModelTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}
export interface ModelToolCall {
  id: string
  name: string
  arguments: string
}
export interface ModelMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  images?: { mimeType: 'image/png' | 'image/jpeg' | 'image/webp'; base64: string }[]
  toolCalls?: ModelToolCall[]
  toolCallId?: string
}
export interface ModelRequest {
  profileId: string
  requestId: string
  model?: string
  threadId?: string
  messages: ModelMessage[]
  tools: ModelTool[]
}
export type ModelEvent =
  | { type: 'delta'; text: string }
  | { type: 'toolCall'; call: ModelToolCall }
  | { type: 'thread'; threadId: string }
  | { type: 'status'; message: string }
  | { type: 'usage'; inputTokens?: number; outputTokens?: number }
  | { type: 'error'; code: string; message: string }
export interface ModelReply {
  text: string
  toolCalls: ModelToolCall[]
  threadId?: string
}
export interface ModelPoll {
  cursor: number
  events: ModelEvent[]
  done: boolean
  reply?: ModelReply
}
export interface ModelStatus {
  available: boolean
  authenticated: boolean
  models: { id: string; name: string }[]
  tools: 'supported' | 'unknown' | 'unsupported'
  images: 'supported' | 'unknown' | 'unsupported'
  error?: string
}
/** Native operation names and payloads used through sdk.nativePlugin.
 * model.profiles.list {} -> ModelProfile[]
 * model.profiles.save ModelProfileInput -> ModelProfile
 * model.profiles.remove {profileId} -> void
 * model.profiles.test {profileId} -> ModelStatus
 * model.account.login {profileId} -> {loginId?,authUrl?,verificationUrl?,userCode?}
 * model.account.logout {profileId} -> void
 * model.stream.start ModelRequest -> {requestId}
 * model.stream.poll {requestId,cursor} -> ModelPoll
 * model.stream.respond {requestId,callId,result:unknown} -> void (Codex tool callback)
 * model.stream.cancel {requestId} -> void
 * model.dispose {} -> void (cancel this activation's runs)
 * Hosts bind each call to the current plugin activation and library scope.
 */
