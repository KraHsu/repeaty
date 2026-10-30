import { expect, it } from 'vitest'
import { SiteStore } from './store'
import { emptyIndex, type SiteBuild } from './model'
const artifact = (label: string): SiteBuild => ({
  index: emptyIndex(),
  fingerprint: label,
  generatedAt: '2026-10-30T12:00:00Z',
  pages: [{ path: 'index.html', title: label }],
  files: [
    {
      path: 'index.html',
      type: 'text/html',
      bytes: new TextEncoder().encode(label.repeat(300_000)),
    },
  ],
})
it('publishes immutable chunks last and retains the previous complete site after save failure', async () => {
  const data = new Map<string, unknown>()
  let fail = false
  const store = new SiteStore({
    get: async (id) => data.get(id),
    set: async (id, value) => {
      if (fail && id === 'site-state-v1') throw new Error('disk-full')
      if (value === undefined) data.delete(id)
      else data.set(id, structuredClone(value))
    },
  })
  await store.save(artifact('first'), ['a'], () => {})
  const before = [...data.keys()]
  fail = true
  await expect(store.save(artifact('second'), ['b'], () => {})).rejects.toThrow('disk-full')
  expect((await store.read()).build?.fingerprint).toBe('first')
  expect([...data.keys()]).toEqual(before)
  fail = false
  await store.save(artifact('third'), ['c'], () => {})
  const reloaded = await new SiteStore({
    get: async (id) => data.get(id),
    set: async () => {},
  }).read()
  expect(new TextDecoder().decode(reloaded.build?.files[0]?.bytes)).toBe('third'.repeat(300_000))
  expect(reloaded.state.selected).toEqual(['c'])
  expect(before.filter((id) => id !== 'site-state-v1').some((id) => data.has(id))).toBe(false)
})
it('does not replace an artifact when cancellation happens between file and pointer writes', async () => {
  const data = new Map<string, unknown>()
  const store = new SiteStore({
    get: async (id) => data.get(id),
    set: async (id, value) => {
      if (value === undefined) data.delete(id)
      else data.set(id, value)
    },
  })
  await store.save(artifact('first'), [], () => {})
  let checks = 0
  await expect(
    store.save(artifact('second'), [], () => {
      if (++checks > 1) throw new DOMException('cancel', 'AbortError')
    }),
  ).rejects.toThrow('cancel')
  expect((await store.read()).build?.fingerprint).toBe('first')
})
