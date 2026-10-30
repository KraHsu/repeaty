import type { Adapter, Binding, Draft, Ledger, Preview, Remote, Store } from './types'
import { fingerprint, hasMarker, publicationMarker } from './util'
import { RemoteRejected } from './http'

export const emptyLedger = (): Ledger => ({ version: 1, bindings: {} })
const compactRemote = (remote: Remote): Remote => ({ ...remote, content: '' })
export function createPublisher(
  adapter: Adapter,
  store: Store,
  current: () => boolean = () => true,
) {
  let busy = false
  const key = (sourceId: string) => `${adapter.connection.site}\n${sourceId}`
  function active(signal: AbortSignal) {
    signal.throwIfAborted()
    if (!current()) throw new Error('workspace-changed')
  }
  function owned(remote: Remote, marker: string) {
    if (!hasMarker(remote.content, marker)) throw new Error('remote-binding-mismatch')
    return remote
  }
  async function lock<T>(signal: AbortSignal, action: () => Promise<T>): Promise<T> {
    active(signal)
    if (busy) throw new Error('publication-busy')
    busy = true
    try {
      return await action()
    } finally {
      busy = false
    }
  }
  async function lookup(binding: Binding | undefined, marker: string, signal: AbortSignal) {
    const remote = binding?.remote
      ? await adapter.read(binding.remote.id, signal)
      : await adapter.find(marker, signal)
    active(signal)
    if (remote) owned(remote, marker)
    return remote
  }
  async function preview(draft: Draft, signal: AbortSignal, remove = false): Promise<Preview> {
    return lock(signal, async () => {
      const state = await store.load()
      active(signal)
      const binding = state.bindings[key(draft.sourceId)]
      if (binding && binding.adapter !== adapter.connection.adapter)
        throw new Error('remote-binding-mismatch')
      if (binding?.state === 'pending' || binding?.state === 'unknown')
        throw new Error('reconcile-required')
      const marker = await publicationMarker(adapter.connection.site, draft.sourceId)
      const found = await lookup(binding, marker, signal)
      const previous =
        binding?.state === 'deleted' && found && ['trash', 'deleted'].includes(found.status)
          ? null
          : found
      if (binding?.remote && !previous && binding.state !== 'deleted')
        throw new Error('remote-missing')
      if (remove && !previous) throw new Error('remote-missing')
      const action = remove ? 'delete' : previous ? 'update' : 'create'
      const connection = structuredClone(adapter.connection)
      const stableDraft = structuredClone(draft)
      const hash = await fingerprint([connection, stableDraft, previous, action])
      active(signal)
      return {
        connection,
        draft: stableDraft,
        previous,
        marker,
        fingerprint: hash,
        action,
        at: Date.now(),
      }
    })
  }
  async function apply(plan: Preview, signal: AbortSignal, validateSource: () => Promise<void>) {
    return lock(signal, async () => {
      if (Date.now() - plan.at > 10 * 60_000 || plan.at > Date.now() + 1_000)
        throw new Error('preview-expired')
      if (
        (await fingerprint([adapter.connection, plan.draft, plan.previous, plan.action])) !==
        plan.fingerprint
      )
        throw new Error('preview-changed')
      const state = await store.load()
      active(signal)
      if (Object.keys(state.bindings).length >= 500 && !state.bindings[key(plan.draft.sourceId)])
        throw new Error('binding-limit')
      const existing = state.bindings[key(plan.draft.sourceId)]
      if (existing?.state === 'pending' || existing?.state === 'unknown')
        throw new Error('reconcile-required')
      const found = await lookup(existing, plan.marker, signal)
      const latest =
        existing?.state === 'deleted' && found && ['trash', 'deleted'].includes(found.status)
          ? null
          : found
      if ((await fingerprint(latest)) !== (await fingerprint(plan.previous)))
        throw new Error('remote-changed')
      await validateSource()
      active(signal)
      const binding: Binding = {
        sourceId: plan.draft.sourceId,
        site: adapter.connection.site,
        adapter: adapter.connection.adapter,
        marker: plan.marker,
        ...(latest ? { remote: compactRemote(latest) } : {}),
        sourceVersion: plan.draft.versionId,
        state: 'pending',
        pending: {
          id: crypto.randomUUID(),
          action: plan.action,
          fingerprint: plan.fingerprint,
          at: new Date().toISOString(),
        },
      }
      // Publish intent durably before the first remote mutation. A failed save sends nothing.
      state.bindings[key(binding.sourceId)] = binding
      let mutationStarted = false
      try {
        await store.save(state)
        active(signal)
        // Intent persistence can yield while external material changes are accepted.
        // Recheck the public projection immediately before the first remote write.
        await validateSource()
        active(signal)
        mutationStarted = true
        const remote =
          plan.action === 'delete'
            ? (await adapter.remove(latest!, signal), null)
            : plan.action === 'create'
              ? await adapter.create(plan.draft, plan.marker, signal)
              : await adapter.update(latest!, plan.draft, plan.marker, signal)
        active(signal)
        if (remote) owned(remote, plan.marker)
        const committed: Binding = {
          ...binding,
          state: remote ? 'ready' : 'deleted',
          pending: undefined,
          ...(remote ? { remote: compactRemote(remote) } : {}),
        }
        state.bindings[key(binding.sourceId)] = committed
        await store.save(state)
        active(signal)
        return committed
      } catch (error) {
        // If this save also fails, the durable pending state still blocks unsafe retries.
        if (current()) {
          if (!mutationStarted || error instanceof RemoteRejected) {
            if (existing) state.bindings[key(binding.sourceId)] = existing
            else delete state.bindings[key(binding.sourceId)]
          } else state.bindings[key(binding.sourceId)] = { ...binding, state: 'unknown' }
          await store.save(state).catch(() => undefined)
        }
        throw error
      }
    })
  }
  async function reconcile(sourceId: string, signal: AbortSignal, remoteId?: string) {
    return lock(signal, async () => {
      const state = await store.load()
      active(signal)
      const binding = state.bindings[key(sourceId)]
      if (!binding) throw new Error('binding-missing')
      const remote = remoteId
        ? await adapter.read(remoteId, signal)
        : await lookup(binding, binding.marker, signal)
      active(signal)
      if (remote) owned(remote, binding.marker)
      if (!remote || ['trash', 'deleted'].includes(remote.status)) {
        if (binding.pending?.action !== 'delete' && binding.state !== 'deleted')
          throw new Error('remote-unconfirmed')
        state.bindings[key(sourceId)] = { ...binding, state: 'deleted', pending: undefined }
      } else {
        state.bindings[key(sourceId)] = {
          ...binding,
          remote: compactRemote(remote),
          state: 'ready',
          pending: undefined,
        }
      }
      await store.save(state)
      active(signal)
      return state.bindings[key(sourceId)]!
    })
  }
  return { preview, apply, reconcile, key }
}
