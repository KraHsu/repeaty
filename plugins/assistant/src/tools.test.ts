import { describe, expect, it, vi } from 'vitest'
import type { AutomationApi, AutomationPreview } from '@repeaty/plugin-api/automation'
import { createAssistantTools } from './tools'
import { emptyContext } from './model'

const context = emptyContext()
const signal = new AbortController().signal
function host() {
  const preview = vi.fn(
    async (request) =>
      ({
        planId: 'plan-1',
        fingerprint: 'immutable-hash',
        request,
        revision: 2,
        changes: [{ entity: 'sources', id: 's1', action: 'update', fields: ['title'] }],
        touched: { sources: ['s1'], folders: [], collections: [], notes: [], decks: [], cards: [] },
        resultIds: { sources: [], folders: [], collections: [], notes: [], decks: [], cards: [] },
      }) as AutomationPreview,
  )
  const apply = vi.fn(async () => ({
    operationId: 'op-1',
    revision: 3,
    replayed: false,
    resultIds: { sources: [], folders: [], collections: [], notes: [], decks: [], cards: [] },
  }))
  const api = {
    query: vi.fn(async () => ({ revision: 2 })),
    preview,
    apply,
    operationStatus: vi.fn(async () => undefined),
  } as unknown as AutomationApi
  return { api, preview, apply }
}
describe('assistant tools', () => {
  it('pages a long source only after the host authorizes the body read', async () => {
    const { api } = host()
    api.query = vi.fn(async () => ({
      sourceId: 's1',
      versionId: 'v1',
      revision: 2,
      text: 'A'.repeat(50000),
    }))
    const result = await createAssistantTools(api).execute(
      {
        id: 'read',
        name: 'library_read',
        arguments: '{"kind":"source.body","sourceId":"s1","bodyOffset":20000,"bodyLimit":10000}',
      },
      context,
      signal,
    )
    expect(api.query).toHaveBeenCalledWith({ kind: 'source.body', sourceId: 's1' }, signal)
    expect(result.result).toMatchObject({
      bodyOffset: 20000,
      nextOffset: 30000,
      text: 'A'.repeat(10000),
      totalCharacters: 50000,
      truncated: true,
    })
  })
  it('only proposes mutations and cannot apply from model tool calls', async () => {
    const { api, apply, preview } = host()
    const tools = createAssistantTools(api)
    const value = await tools.execute(
      {
        id: 'tool-1',
        name: 'library_propose',
        arguments: JSON.stringify({
          title: '更正标题',
          expectedRevision: 2,
          commands: [
            { kind: 'source.patch', sourceId: 's1', versionId: 'v1', patch: { title: '间隔重复' } },
          ],
        }),
      },
      context,
      signal,
    )
    expect(value.proposal?.status).toBe('pending')
    expect(preview).toHaveBeenCalledOnce()
    expect(apply).not.toHaveBeenCalled()
    expect(tools.definitions.some((tool) => tool.name.includes('apply'))).toBe(false)
    await tools.apply(value.proposal!, context, signal)
    expect(apply).toHaveBeenCalledOnce()
  })

  it('relies on host grant enforcement and never retries a denied read via another API', async () => {
    const { api } = host()
    const denied = vi.fn(async () => {
      throw new Error('scope-denied')
    })
    api.query = denied
    await expect(
      createAssistantTools(api).execute(
        {
          id: 'tool-1',
          name: 'library_read',
          arguments: '{"kind":"source.body","sourceId":"outside-scope"}',
        },
        context,
        signal,
      ),
    ).rejects.toThrow('scope-denied')
    expect(denied).toHaveBeenCalledOnce()
  })

  it('resolves a lost commit reply by receipt rather than replaying a different command', async () => {
    const { api, apply } = host()
    const tools = createAssistantTools(api)
    const result = await tools.execute(
      {
        id: 'tool-1',
        name: 'library_propose',
        arguments:
          '{"title":"New deck","expectedRevision":2,"commands":[{"kind":"deck.create","input":{"name":"Review"}}]}',
      },
      context,
      signal,
    )
    apply.mockRejectedValueOnce(new Error('lost-reply'))
    const receipt = {
      operationId: 'receipt',
      revision: 3,
      replayed: true,
      resultIds: { sources: [], folders: [], collections: [], notes: [], decks: [], cards: [] },
    }
    api.operationStatus = vi.fn().mockResolvedValueOnce(undefined).mockResolvedValueOnce(receipt)
    expect(await tools.apply(result.proposal!, context, signal)).toEqual(receipt)
    expect(apply).toHaveBeenCalledOnce()
  })
})
