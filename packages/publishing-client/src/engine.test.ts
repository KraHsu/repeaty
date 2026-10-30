import { describe, expect, it, vi } from 'vitest'
import { createPublisher, emptyLedger } from './engine'
import { marked } from './util'
import { RemoteRejected, PartialMutation } from './http'
import type { Adapter, Draft, Ledger, Remote } from './types'

it('revalidates after pending persistence so newly private content is never sent', async () => {
  const f = fixture()
  const engine = createPublisher(f.adapter, f.store)
  let privateNow = false
  const save = f.store.save
  f.store.save = vi.fn(async (state) => {
    await save(state)
    privateNow = true
  })
  const controller = new AbortController()
  const plan = await engine.preview(draft, controller.signal)
  await expect(
    engine.apply(plan, controller.signal, async () => {
      if (privateNow) throw new Error('source-private')
    }),
  ).rejects.toThrow('source-private')
  expect(f.adapter.create).not.toHaveBeenCalled()
  expect(Object.values(f.state().bindings)).toEqual([])
})

const draft: Draft = {
  sourceId: 'source',
  versionId: 'v1',
  title: '间隔复习',
  content: '正文',
  status: 'draft',
  category: '',
  tags: [],
}
function fixture() {
  let state: Ledger = emptyLedger()
  let remote: Remote | null = null
  const adapter: Adapter = {
    provider: 'wordpress',
    connection: { site: 'https://example.com', adapter: 'rest', slot: 'account' },
    verify: vi.fn(),
    catalog: vi.fn(),
    find: vi.fn(async () => structuredClone(remote)),
    read: vi.fn(async () => structuredClone(remote)),
    create: vi.fn(async (value, marker) => {
      remote = {
        id: '7',
        url: 'https://example.com/post',
        title: value.title,
        content: marked(value.content, marker),
        status: value.status,
        category: value.category,
        tags: value.tags,
        revision: 'one',
      }
      return structuredClone(remote)
    }),
    update: vi.fn(async (_old, value, marker) => {
      remote = {
        ...remote!,
        title: value.title,
        content: marked(value.content, marker),
        revision: 'two',
      }
      return structuredClone(remote)
    }),
    remove: vi.fn(async () => {
      remote = null
    }),
  }
  const store = {
    load: vi.fn(async () => structuredClone(state)),
    save: vi.fn(async (value: Ledger) => {
      state = structuredClone(value)
    }),
  }
  return {
    adapter,
    store,
    state: () => state,
    setRemote: (value: Remote | null) => {
      remote = value
    },
    remote: () => remote,
  }
}
const signal = () => new AbortController().signal
describe('durable publication transactions', () => {
  it('writes intent before sending, then updates the original after reloading', async () => {
    const f = fixture()
    const engine = createPublisher(f.adapter, f.store)
    const create = f.adapter.create
    f.adapter.create = vi.fn(async (...args: Parameters<Adapter['create']>) => {
      expect(Object.values(f.state().bindings)[0]?.state).toBe('pending')
      return create(...args)
    })
    await engine.apply(await engine.preview(draft, signal()), signal(), async () => undefined)
    expect(Object.values(f.state().bindings)[0]?.remote?.content).toBe('')
    const restarted = createPublisher(f.adapter, f.store)
    const plan = await restarted.preview({ ...draft, content: '更新' }, signal())
    expect(plan.action).toBe('update')
    await restarted.apply(plan, signal(), async () => undefined)
    expect(f.adapter.create).toHaveBeenCalledTimes(1)
    expect(f.adapter.update).toHaveBeenCalledTimes(1)
  })
  it('never sends after an intent save fails', async () => {
    const f = fixture()
    const engine = createPublisher(f.adapter, f.store)
    const plan = await engine.preview(draft, signal())
    f.store.save.mockRejectedValueOnce(new Error('disk-full'))
    await expect(engine.apply(plan, signal(), async () => undefined)).rejects.toThrow('disk-full')
    expect(f.adapter.create).not.toHaveBeenCalled()
  })
  it('keeps unknown after a lost create reply, then reconciles without another create', async () => {
    const f = fixture()
    const engine = createPublisher(f.adapter, f.store)
    const create = f.adapter.create
    f.adapter.create = vi.fn(async (...args: Parameters<Adapter['create']>) => {
      await create(...args)
      throw new Error('timeout')
    })
    await expect(
      engine.apply(await engine.preview(draft, signal()), signal(), async () => undefined),
    ).rejects.toThrow('timeout')
    expect(Object.values(f.state().bindings)[0]?.state).toBe('unknown')
    const restarted = createPublisher(f.adapter, f.store)
    await expect(restarted.preview(draft, signal())).rejects.toThrow('reconcile-required')
    expect((await restarted.reconcile('source', signal())).remote?.id).toBe('7')
    expect((await restarted.preview(draft, signal())).action).toBe('update')
    expect(f.adapter.create).toHaveBeenCalledTimes(1)
  })
  it('restores retryability for cancellation before send and a definite first-write rejection', async () => {
    const f = fixture()
    const engine = createPublisher(f.adapter, f.store)
    const controller = new AbortController()
    const plan = await engine.preview(draft, signal())
    const save = f.store.save.getMockImplementation()!
    f.store.save.mockImplementationOnce(async (state) => {
      await save(state)
      controller.abort()
    })
    await expect(engine.apply(plan, controller.signal, async () => undefined)).rejects.toThrow()
    expect(Object.keys(f.state().bindings)).toHaveLength(0)
    expect(f.adapter.create).not.toHaveBeenCalled()
    f.adapter.create = vi.fn(async () => {
      throw new RemoteRejected(401)
    })
    await expect(
      engine.apply(await engine.preview(draft, signal()), signal(), async () => undefined),
    ).rejects.toThrow('remote-http-401')
    expect(Object.keys(f.state().bindings)).toHaveLength(0)
    expect((await engine.preview(draft, signal())).action).toBe('create')
  })
  it('keeps successful-create followed by a rejected read uncertain and blocks a second create', async () => {
    const f = fixture()
    const engine = createPublisher(f.adapter, f.store)
    f.adapter.create = vi.fn(async () => {
      throw new PartialMutation()
    })
    await expect(
      engine.apply(await engine.preview(draft, signal()), signal(), async () => undefined),
    ).rejects.toThrow('remote-result-unknown')
    await expect(engine.preview(draft, signal())).rejects.toThrow('reconcile-required')
    await expect(engine.reconcile('source', signal())).rejects.toThrow('remote-unconfirmed')
    expect(f.adapter.create).toHaveBeenCalledTimes(1)
  })
  it('refuses stale remote content and stale source revisions before a mutation', async () => {
    const f = fixture()
    const engine = createPublisher(f.adapter, f.store)
    await engine.apply(await engine.preview(draft, signal()), signal(), async () => undefined)
    const plan = await engine.preview({ ...draft, content: 'edited' }, signal())
    f.setRemote({ ...f.remote()!, title: 'Changed in WordPress' })
    await expect(engine.apply(plan, signal(), async () => undefined)).rejects.toThrow(
      'remote-changed',
    )
    const newer = await engine.preview(draft, signal())
    await expect(
      engine.apply(newer, signal(), async () => {
        throw new Error('source-changed')
      }),
    ).rejects.toThrow('source-changed')
    expect(f.adapter.update).not.toHaveBeenCalled()
  })
  it('retains durable pending on scope loss and never writes results into the new library', async () => {
    const f = fixture()
    let active = true
    const engine = createPublisher(f.adapter, f.store, () => active)
    const create = f.adapter.create
    f.adapter.create = vi.fn(async (...args: Parameters<Adapter['create']>) => {
      const result = await create(...args)
      active = false
      return result
    })
    await expect(
      engine.apply(await engine.preview(draft, signal()), signal(), async () => undefined),
    ).rejects.toThrow('workspace-changed')
    expect(f.store.save).toHaveBeenCalledTimes(1)
    expect(Object.values(f.state().bindings)[0]?.state).toBe('pending')
  })
  it('recovers a lost deletion reply by reading the known ID and leaves local data intact', async () => {
    const f = fixture()
    const engine = createPublisher(f.adapter, f.store)
    await engine.apply(await engine.preview(draft, signal()), signal(), async () => undefined)
    f.adapter.remove = vi.fn(async () => {
      f.setRemote(null)
      throw new Error('timeout')
    })
    await expect(
      engine.apply(await engine.preview(draft, signal(), true), signal(), async () => undefined),
    ).rejects.toThrow('timeout')
    expect((await engine.reconcile('source', signal())).state).toBe('deleted')
    expect(draft.content).toBe('正文')
  })
  it('rejects mismatched ownership, changed previews and concurrent writes', async () => {
    const f = fixture()
    const engine = createPublisher(f.adapter, f.store)
    const plan = await engine.preview(draft, signal())
    plan.draft.content = 'tampered'
    await expect(engine.apply(plan, signal(), async () => undefined)).rejects.toThrow(
      'preview-changed',
    )
    f.setRemote({
      id: '7',
      url: 'https://example.com/other',
      content: 'other post',
      title: 'other',
      status: 'publish',
      category: '',
      tags: [],
      revision: 'a',
    })
    await expect(engine.preview(draft, signal())).rejects.toThrow('remote-binding-mismatch')
  })
})
