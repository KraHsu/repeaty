import { describe, expect, it, vi } from 'vitest'
import { ConversationController } from './controller'
import {
  AssistantError,
  type AssistantTools,
  type Provider,
  type ProviderProfile,
  type ProviderReply,
} from './model'
import { SessionStore, type DataStore } from './store'

const profile: ProviderProfile = {
  id: 'test',
  name: 'Test',
  kind: 'openai-compatible',
  endpoint: 'https://example.test/v1',
  model: 'fixture',
}
function memory() {
  const values = new Map<string, unknown>()
  const data: DataStore = {
    async get(id) {
      return structuredClone(values.get(id))
    },
    async set(id, value) {
      values.set(id, structuredClone(value))
    },
  }
  return { values, data }
}
function setup(provider: Provider, data = memory().data) {
  const store = new SessionStore(data)
  const tools: AssistantTools = {
    definitions: [{ name: 'read', description: 'read', parameters: { type: 'object' } }],
    execute: vi.fn(async () => ({ result: { content: 'Only authorized material' } })),
    apply: vi.fn(async () => ({ revision: 2 })),
  }
  const controller = new ConversationController(store, provider, tools, vi.fn())
  const thread = store.create(profile.id)
  thread.draft = '解释一下间隔重复'
  return { store, tools, controller, thread }
}

describe('assistant conversations', () => {
  it('streams, executes tools once, persists messages and continues a stored session', async () => {
    const requests: unknown[] = []
    const replies: ProviderReply[] = [
      { text: '', toolCalls: [{ id: 'call-1', name: 'read', arguments: '{}' }] },
      { text: '间隔重复安排逐步扩大的复习间隔。', toolCalls: [], threadId: 'native-thread' },
    ]
    const { store, controller, thread, tools } = setup({
      async complete(request, emit) {
        requests.push(request.messages)
        const reply = replies.shift()!
        emit({ type: 'delta', text: reply.text })
        return reply
      },
    })
    await controller.send(thread, profile)
    expect(thread.error).toBeUndefined()
    expect(thread.draft).toBe('')
    expect(tools.execute).toHaveBeenCalledTimes(1)
    expect(requests).toHaveLength(2)
    expect((await store.load(thread.id)).messages.at(-1)?.text).toContain('复习间隔')
    expect((await store.list())[0]?.providerThreadId).toBe('native-thread')
    const continued = store.continue(await store.load(thread.id))
    expect(continued.continuedFrom).toBe(thread.id)
    expect(continued.providerThreadId).toBeUndefined()
    expect(continued.messages[0]?.id).not.toBe(thread.messages[0]?.id)
  })

  it('keeps partial text and submitted draft on cancellation, ignores late chunks', async () => {
    let started!: () => void
    const ready = new Promise<void>((resolve) => {
      started = resolve
    })
    const { store, controller, thread } = setup({
      async complete(request, emit) {
        emit({ type: 'delta', text: '部分回复' })
        started()
        await new Promise<void>((_resolve, reject) =>
          request.signal.addEventListener(
            'abort',
            () => {
              emit({ type: 'delta', text: '不应出现' })
              reject(new DOMException('Aborted', 'AbortError'))
            },
            { once: true },
          ),
        )
        return { text: '', toolCalls: [] }
      },
    })
    const pending = controller.send(thread, profile)
    await ready
    controller.cancel()
    await pending
    expect(thread.draft).toBe('解释一下间隔重复')
    expect(thread.messages.at(-1)?.text).toBe('部分回复')
    expect(thread.messages.at(-1)?.status).toBe('interrupted')
    expect((await store.load(thread.id)).error).toBe('interrupted')
  })

  it('does not make a request if initial draft persistence fails', async () => {
    const complete = vi.fn()
    const { controller, thread } = setup(
      { complete },
      {
        async get() {
          return undefined
        },
        async set() {
          throw new Error('Disk full')
        },
      },
    )
    await controller.send(thread, profile)
    expect(complete).not.toHaveBeenCalled()
    expect(thread.draft).toBe('解释一下间隔重复')
    expect(thread.messages).toHaveLength(0)
    expect(thread.error).toBe('storage')
  })

  it('does not execute duplicate calls and keeps unknown provider failure details out of storage', async () => {
    const { controller, thread, tools } = setup({
      async complete() {
        return { text: '', toolCalls: [{ id: 'duplicate', name: 'read', arguments: '{}' }] }
      },
    })
    await controller.send(thread, profile)
    expect(tools.execute).toHaveBeenCalledTimes(1)
    expect(thread.error).toBe('protocol')
    const next = setup({
      async complete() {
        throw new Error('Bearer secret-sensitive')
      },
    })
    await next.controller.send(next.thread, profile)
    expect(JSON.stringify(await next.store.load(next.thread.id))).not.toContain('secret-sensitive')
  })

  it('applies only an explicitly selected proposal; does not apply while generating', async () => {
    const { store, controller, thread, tools } = setup({
      async complete() {
        throw new AssistantError('network')
      },
    })
    const message = {
      id: crypto.randomUUID(),
      role: 'assistant' as const,
      text: '修改建议',
      createdAt: new Date().toISOString(),
      proposals: [
        {
          id: 'plan',
          title: '更正标题',
          preview: { changes: ['title'] },
          status: 'pending' as const,
        },
      ],
    }
    thread.messages.push(message)
    expect(tools.apply).not.toHaveBeenCalled()
    await controller.apply(thread, message, 'plan')
    expect(tools.apply).toHaveBeenCalledTimes(1)
    await controller.apply(thread, message, 'plan')
    expect(tools.apply).toHaveBeenCalledTimes(1)
    expect((await store.load(thread.id)).messages[0]?.proposals?.[0]?.status).toBe('applied')
  })

  it('archive, delete and restore preserve the conversation and draft', async () => {
    const { store, thread } = setup({
      async complete() {
        return { text: '', toolCalls: [] }
      },
    })
    for (const status of ['archived', 'deleted', 'active'] as const) {
      thread.status = status
      await store.save(thread)
      const restored = await store.load(thread.id)
      expect(restored.status).toBe(status)
      expect(restored.draft).toBe('解释一下间隔重复')
    }
  })
})
