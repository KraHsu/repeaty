import { expect, it, vi } from 'vitest'
import { prepareSource } from '../core/sources'
import { MaterialKnowledgeIndex } from '../core/material-search'
import { createMaterialKnowledge, type KnowledgeTransport } from './material-knowledge'

function host() {
  let scope = 'one'
  const prepared = prepareSource({
    title: 'Title',
    format: 'markdown',
    url: '',
    content: 'one body [[Title]]',
  })
  let sources = [prepared.source]
  const read = vi.fn(async () => 'one body [[Title]]')
  let disposed = 0
  const factory = () => {
    const index = new MaterialKnowledgeIndex()
    return {
      call: async (request, signal) => {
        signal.throwIfAborted()
        return index.handle(request)
      },
      dispose: () => {
        disposed++
      },
    } as KnowledgeTransport
  }
  const client = createMaterialKnowledge(
    { scope: () => scope, sources: () => sources, read },
    factory,
  )
  return {
    client,
    read,
    setScope: (value: string) => {
      scope = value
    },
    replace: (value: typeof sources) => {
      sources = value
    },
    sources,
    disposed: () => disposed,
  }
}
it('reads each immutable version once across queries, metadata changes and backlinks, and rebuilds on demand', async () => {
  const env = host()
  await env.client.search('body')
  await env.client.search('one')
  await env.client.context(env.sources[0]!.id)
  expect(env.read).toHaveBeenCalledTimes(1)
  env.replace([{ ...env.sources[0]!, title: 'Renamed' }])
  expect((await env.client.search('Renamed')).hits[0]!.title).toBe('Renamed')
  expect(env.read).toHaveBeenCalledTimes(1)
  env.replace([{ ...env.sources[0]!, mediaId: 'new-version' }])
  await env.client.search('body')
  expect(env.read).toHaveBeenCalledTimes(2)
  env.client.rebuild()
  await env.client.search('body')
  expect(env.read).toHaveBeenCalledTimes(3)
  expect(env.disposed()).toBe(1)
  env.client.dispose()
})
it('does not read or create a worker until an explicit operation, and rejects old library ownership', async () => {
  const env = host()
  expect(env.read).not.toHaveBeenCalled()
  env.setScope('other')
  await expect(env.client.search('body')).rejects.toMatchObject({ name: 'AbortError' })
  expect(env.read).not.toHaveBeenCalled()
})
it('rebuilds a restored body that a preview-only metadata sync removed from the worker', async () => {
  const env = host()
  const second = { ...env.sources[0]!, id: 'second', mediaId: 'second-body' }
  env.replace([...env.sources, second])
  await env.client.search('body')
  expect(env.read).toHaveBeenCalledTimes(2)
  env.replace([second])
  await env.client.preview(second.id)
  env.replace([...env.sources, second])
  expect((await env.client.search('body')).hits).toHaveLength(2)
  expect(env.read).toHaveBeenCalledTimes(3)
  env.client.dispose()
})
it('rejects cancellation and late reads without publishing partial or changed-version results', async () => {
  const env = host()
  let finish!: (value: string) => void
  env.read.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  const abort = new AbortController()
  const result = env.client.search('body', [], false, 0, { signal: abort.signal })
  const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' })
  await vi.waitFor(() => expect(env.read).toHaveBeenCalledTimes(1))
  abort.abort()
  finish('old body')
  await rejected
  expect((await env.client.search('body')).hits).toHaveLength(1)
  let next!: (value: string) => void
  env.replace([{ ...env.sources[0]!, mediaId: 'next' }])
  env.read.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        next = resolve
      }),
  )
  const pending = env.client.search('body')
  const stale = expect(pending).rejects.toThrow('材料已变化')
  await vi.waitFor(() => expect(env.read).toHaveBeenCalledTimes(3))
  env.replace([{ ...env.sources[0]!, mediaId: 'third' }])
  next('stale body')
  await stale
  env.client.dispose()
})
