import { describe, expect, it, vi } from 'vitest'
import { createNativeProvider, createProfiles } from './adapter'
import { emptyContext, type ProviderRequest } from './model'

function request(
  kind: 'codex-app-server' | 'openai-compatible' = 'openai-compatible',
): ProviderRequest {
  return {
    requestId: 'request-1',
    profile: {
      id: 'profile-1',
      name: 'Learning',
      kind,
      model: 'fixture-model',
      endpoint: 'https://example.test/v1',
    },
    messages: [{ id: 'm1', role: 'user', text: 'Explain memory.', createdAt: '' }],
    tools: [],
    context: emptyContext(),
    signal: new AbortController().signal,
  }
}
describe('native provider adapter', () => {
  it('normalizes profiles without ever reading credentials', async () => {
    const native = vi.fn(async (_operation: string, _payload: unknown) => [
      { id: 'p1', name: 'Codex', kind: 'codex', defaultModel: 'model', hasCredential: false },
    ])
    expect(await createProfiles(native).list()).toEqual([
      {
        id: 'p1',
        name: 'Codex',
        kind: 'codex-app-server',
        endpoint: '',
        model: 'model',
        executable: undefined,
        hasCredential: false,
      },
    ])
    expect(native).toHaveBeenCalledWith('model.profiles.list', {})
  })

  it('streams compatible-provider replies and preserves pending tool calls for the outer loop', async () => {
    const deltas: unknown[] = []
    const call = { id: 'read-1', name: 'library_read', arguments: '{"kind":"library"}' }
    const native = vi.fn(async (operation: string) => {
      if (operation === 'model.stream.start') return { requestId: 'request-1' }
      return {
        cursor: 2,
        events: [
          { type: 'delta', text: 'Checking material.' },
          { type: 'toolCall', call },
        ],
        done: true,
        reply: { text: 'Checking material.', toolCalls: [call] },
      }
    })
    const value = await createNativeProvider(native).complete(request(), (event) =>
      deltas.push(event),
    )
    expect(value.toolCalls).toEqual([call])
    expect(deltas).toEqual([{ type: 'delta', text: 'Checking material.' }])
    expect(native).not.toHaveBeenCalledWith('model.stream.respond', expect.anything())
  })

  it('answers a Codex dynamic tool request before awaiting completion, without repeating it', async () => {
    const tool = { id: 'read-1', name: 'library_read', arguments: '{"kind":"library"}' }
    const handled = vi.fn(async () => ({ revision: 3 }))
    let responded = false
    const native = vi.fn(async (operation: string, payload: unknown) => {
      if (operation === 'model.stream.start') return { requestId: 'request-1' }
      if (operation === 'model.stream.respond') {
        expect(payload).toEqual({
          requestId: 'request-1',
          callId: 'read-1',
          result: { revision: 3 },
        })
        responded = true
        return null
      }
      return responded
        ? {
            cursor: 2,
            events: [{ type: 'delta', text: 'Ready.' }],
            done: true,
            reply: { text: 'Ready.', threadId: 'codex-thread', toolCalls: [tool] },
          }
        : { cursor: 1, events: [{ type: 'toolCall', call: tool }], done: false }
    })
    const value = await createNativeProvider(native).complete(
      { ...request('codex-app-server'), handleTool: handled },
      () => {},
    )
    expect(handled).toHaveBeenCalledOnce()
    expect(value).toEqual({ text: 'Ready.', threadId: 'codex-thread', toolCalls: [] })
  })

  it('cancels a native run after start races with abort', async () => {
    const controller = new AbortController()
    const native = vi.fn(async (operation: string) => {
      if (operation === 'model.stream.start') controller.abort()
      return null
    })
    await expect(
      createNativeProvider(native).complete({ ...request(), signal: controller.signal }, () => {}),
    ).rejects.toThrow()
    expect(native).toHaveBeenCalledWith('model.stream.cancel', { requestId: 'request-1' })
  })

  it('does not expose raw provider errors containing credentials', async () => {
    const native = vi.fn(async (operation: string) =>
      operation === 'model.stream.start'
        ? {}
        : {
            cursor: 1,
            events: [{ type: 'error', code: 'auth_failed', message: 'Bearer secret-value' }],
            done: true,
          },
    )
    await expect(createNativeProvider(native).complete(request(), () => {})).rejects.toThrow(
      'authentication',
    )
    expect(native).toHaveBeenCalledWith('model.stream.cancel', { requestId: 'request-1' })
  })

  it('removes unfinished tool pairs after interruption and sends explicit image input', async () => {
    const native = vi.fn(async (operation: string, _payload: unknown) =>
      operation === 'model.stream.start'
        ? {}
        : { cursor: 1, events: [], done: true, reply: { text: 'Done', toolCalls: [] } },
    )
    const input = request()
    input.messages = [
      {
        id: '1',
        role: 'assistant',
        createdAt: '',
        text: 'Checking',
        toolCalls: [
          { id: 'done', name: 'read', arguments: '{}' },
          { id: 'unfinished', name: 'read', arguments: '{}' },
        ],
      },
      { id: '2', role: 'tool', createdAt: '', text: 'Material', toolCallId: 'done' },
      {
        id: '3',
        role: 'user',
        createdAt: '',
        text: 'Compare this diagram',
        images: [{ id: 'image', name: 'Diagram.png', mime: 'image/png', size: 2, data: 'eHg=' }],
      },
    ]
    await createNativeProvider(native).complete(input, () => {})
    const payload = native.mock.calls[0]?.[1] as unknown as { messages: unknown[] }
    expect(JSON.stringify(payload.messages)).not.toContain('unfinished')
    expect(payload.messages.at(-1)).toMatchObject({
      role: 'user',
      images: [{ mimeType: 'image/png', base64: 'eHg=' }],
    })
  })
})
