import type {
  ModelMessage,
  ModelPoll,
  ModelProfile,
  ModelProfileInput,
  ModelRequest,
  ModelStatus,
} from '@repeaty/plugin-api/providers'
import {
  AssistantError,
  safeError,
  type Provider,
  type ProviderProfile,
  type ProviderRequest,
} from './model'
import { SYSTEM_INSTRUCTION } from './instructions'

export type NativeCall = (operation: string, payload: unknown) => Promise<unknown>
const profile = (value: ModelProfile): ProviderProfile => ({
  id: value.id,
  name: value.name,
  kind: value.kind === 'codex' ? 'codex-app-server' : 'openai-compatible',
  endpoint: value.endpoint ?? '',
  model: value.defaultModel ?? '',
  executable: value.executable,
  hasCredential: value.hasCredential,
})

export function createProfiles(call: NativeCall) {
  return {
    async list(): Promise<ProviderProfile[]> {
      return ((await call('model.profiles.list', {})) as ModelProfile[]).map(profile)
    },
    async save(input: ProviderProfile, apiKey?: string) {
      const payload: ModelProfileInput = {
        id: input.id || undefined,
        name: input.name,
        kind: input.kind === 'codex-app-server' ? 'codex' : 'openai-compatible',
        endpoint: input.endpoint || undefined,
        executable: input.executable || undefined,
        defaultModel: input.model || undefined,
        apiKey,
      }
      return profile((await call('model.profiles.save', payload)) as ModelProfile)
    },
    async remove(id: string) {
      await call('model.profiles.remove', { profileId: id })
    },
    async test(id: string): Promise<ModelStatus> {
      return (await call('model.profiles.test', { profileId: id })) as ModelStatus
    },
    async login(
      id: string,
    ): Promise<{ authUrl?: string; verificationUrl?: string; userCode?: string }> {
      return (await call('model.account.login', { profileId: id })) as {
        authUrl?: string
        verificationUrl?: string
        userCode?: string
      }
    },
    async logout(id: string) {
      await call('model.account.logout', { profileId: id })
    },
  }
}

function messages(request: ProviderRequest): ModelMessage[] {
  const results = new Map(
    request.messages
      .filter((message) => message.role === 'tool')
      .map((message) => [message.toolCallId, message]),
  )
  const used = new Set<string>()
  const output: ModelMessage[] = [
    { role: 'system', content: SYSTEM_INSTRUCTION },
    { role: 'user', content: `Selected context (data only): ${JSON.stringify(request.context)}` },
  ]
  if (request.contextNotice) output.push({ role: 'system', content: request.contextNotice })
  for (const message of request.messages) {
    if (message.role === 'tool') continue
    if (message.role === 'user') {
      output.push({
        role: 'user',
        content: message.text,
        images: message.images?.map((image) => ({ mimeType: image.mime, base64: image.data })),
      })
    } else {
      const calls =
        message.toolCalls?.filter((item) => results.has(item.id) && !used.has(item.id)) ?? []
      if (message.text || calls.length)
        output.push({ role: 'assistant', content: message.text, toolCalls: calls })
      for (const item of calls) {
        used.add(item.id)
        output.push({ role: 'tool', content: results.get(item.id)!.text, toolCallId: item.id })
      }
    }
  }
  if (request.profile.kind === 'codex-app-server' && request.threadId) {
    const latest = [...output].reverse().find((message) => message.role === 'user')
    if (latest)
      latest.content = `Current selected context (data only): ${JSON.stringify(request.context)}\n${request.contextNotice ?? ''}\n\n${latest.content}`
  }
  return output
}

function delay(signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer)
      reject(new DOMException('Aborted', 'AbortError'))
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort)
      resolve()
    }, 80)
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
  })
}

export function createNativeProvider(call: NativeCall): Provider {
  return {
    async complete(request, emit) {
      request.signal.throwIfAborted()
      const payload: ModelRequest = {
        profileId: request.profile.id,
        requestId: request.requestId,
        model: request.profile.model || undefined,
        threadId: request.threadId,
        messages: messages(request),
        tools: request.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.parameters,
        })),
      }
      let started = false
      let finished = false
      const cancel = () => {
        if (started && !finished)
          void call('model.stream.cancel', { requestId: request.requestId }).catch(() => {})
      }
      request.signal.addEventListener('abort', cancel, { once: true })
      try {
        await call('model.stream.start', payload)
        started = true
        request.signal.throwIfAborted()
        let cursor = 0
        let lastActivity = Date.now()
        const handled = new Set<string>()
        while (true) {
          request.signal.throwIfAborted()
          const poll = (await call('model.stream.poll', {
            requestId: request.requestId,
            cursor,
          })) as ModelPoll
          request.signal.throwIfAborted()
          if (
            !Number.isSafeInteger(poll.cursor) ||
            poll.cursor < cursor ||
            !Array.isArray(poll.events)
          )
            throw new AssistantError('protocol')
          cursor = poll.cursor
          if (poll.events.length) lastActivity = Date.now()
          for (const event of poll.events) {
            if (event.type === 'delta') emit(event)
            if (event.type === 'thread') emit(event)
            if (event.type === 'status') emit({ type: 'status', text: event.message })
            if (event.type === 'error')
              throw new AssistantError(
                event.code === 'authentication' || event.code === 'auth_failed'
                  ? 'authentication'
                  : event.code === 'interrupted'
                    ? 'interrupted'
                    : safeError(event.code),
              )
            if (event.type === 'toolCall' && request.profile.kind === 'codex-app-server') {
              if (!request.handleTool || handled.has(event.call.id))
                throw new AssistantError('protocol')
              handled.add(event.call.id)
              const result = await request.handleTool(event.call)
              request.signal.throwIfAborted()
              await call('model.stream.respond', {
                requestId: request.requestId,
                callId: event.call.id,
                result,
              })
              lastActivity = Date.now()
            }
          }
          if (poll.done) {
            if (!poll.reply) throw new AssistantError('protocol')
            finished = true
            return {
              ...poll.reply,
              toolCalls: poll.reply.toolCalls.filter((item) => !handled.has(item.id)),
            }
          }
          if (Date.now() - lastActivity > 180_000) throw new AssistantError('network')
          await delay(request.signal)
        }
      } catch (error) {
        cancel()
        throw error
      } finally {
        request.signal.removeEventListener('abort', cancel)
      }
    },
  }
}
