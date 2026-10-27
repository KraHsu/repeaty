import { computed, ref, shallowRef, watch } from 'vue'
import { z } from 'zod'
import { type Library } from '../core/model'
import { type FileChange } from '../workspace/changes'
import { previewScanSchema } from '../workspace/preview'
import { createInspector, type Inspector } from './workspace-inspector'
import {
  scanSchema,
  documentSchema,
  workingSchema,
  bindingSchema,
  type WorkspaceScan,
} from './workspace-scan'
import { workspaceStatus, workspaceApi, type ActiveWorkspace, type NativeApi } from './workspaces'
import type { useLibrary } from '../composables/useLibrary'
import type { DisplayMessage } from '../i18n'

const deltaSchema = z.object({
  prefixes: z.array(z.string()),
  accepted: z.array(documentSchema),
  working: z.array(workingSchema),
  removed: z.array(z.string()),
  bindings: z.array(bindingSchema),
  attention: scanSchema.shape.attention,
  retired: scanSchema.shape.retired.optional(),
  retiredCount: scanSchema.shape.retiredCount.optional(),
})
const eventSchema = z.object({
  paths: z.array(z.string()).max(512),
  full: z.boolean(),
  available: z.boolean(),
})
const under = (path: string, prefix: string) => path === prefix || path.startsWith(prefix + '/')
const key = (entry: { kind: string; id: string }) => entry.kind + ':' + entry.id

export function createWorkspaceMonitor(
  active: ActiveWorkspace,
  library: () => Library,
  api: NativeApi = workspaceApi,
  inspector: Inspector = createInspector(),
) {
  const snapshot = shallowRef<WorkspaceScan>(),
    changes = shallowRef<FileChange[]>([])
  const error = shallowRef<DisplayMessage>(''),
    available = ref(true),
    checking = ref(false)
  let alive = true,
    running = false,
    full = false,
    timer: ReturnType<typeof setTimeout> | undefined
  const paths = new Set<string>(),
    assets = new Set<string>(),
    hashes = new Map<string, string | null>()
  let base: FileChange[] = []
  let publishedBase: FileChange[] | undefined,
    publishedMedia = ''
  const waiters: { resolve(): void; reject(error: unknown): void }[] = []
  const read = <T>(request: unknown) => api<T>('workspace_read', { token: active.token, request })
  function publish() {
    if (!alive || !snapshot.value) return
    const changed = new Set(
      snapshot.value.bindings
        .filter((entry) =>
          entry.media.some((ref) => hashes.has(ref.path) && hashes.get(ref.path) !== ref.hash),
        )
        .map(key),
    )
    const mediaSignature = JSON.stringify([...changed].sort())
    if (publishedBase === base && publishedMedia === mediaSignature) return
    publishedBase = base
    publishedMedia = mediaSignature
    changes.value = base.map((file) =>
      file.status === 'unchanged' && file.identity && changed.has(key(file.identity))
        ? { ...file, status: 'modified', reason: 'media-changed' }
        : file,
    )
  }
  async function classify(value: WorkspaceScan) {
    const cards = new Map<string, { id: string; variant: string; lifecycle: 'active' }[]>()
    for (const card of library().cards) {
      const list = cards.get(card.noteId) ?? []
      list.push({ id: card.id, variant: card.variant, lifecycle: 'active' })
      cards.set(card.noteId, list)
    }
    const parsed = await inspector.inspect(
      previewScanSchema.parse({
        token: active.token,
        complete: true,
        accepted: value.accepted.map((doc) => ({
          id: doc.id,
          path: doc.path,
          raw: doc.raw,
          cards: doc.kind === 'note' ? (cards.get(doc.id) ?? []) : [],
        })),
        observations: value.working,
        issues: [],
      }),
    )
    if (alive) {
      snapshot.value = value
      base = parsed
      publish()
    }
  }
  function bindingsChanged(value: WorkspaceScan) {
    const used = new Set(value.bindings.flatMap((entry) => entry.media.map((ref) => ref.path)))
    for (const path of hashes.keys()) if (!used.has(path)) hashes.delete(path)
    for (const path of assets) if (!used.has(path)) assets.delete(path)
    for (const path of used) if (!hashes.has(path)) assets.add(path)
  }
  async function process() {
    if (!alive || running) return
    running = true
    checking.value = true
    let failure: unknown
    let completing: typeof waiters = []
    try {
      if (full || !snapshot.value) {
        full = false
        completing = waiters.splice(0)
        paths.clear()
        const value = scanSchema.parse(await read({ type: 'observe', full: true }))
        if (!alive) return
        await classify(value)
        bindingsChanged(value)
        for (const waiter of completing.splice(0)) waiter.resolve()
        // A focus/recovery scan also verifies files whose notifications were missed.
        for (const entry of value.bindings) for (const ref of entry.media) assets.add(ref.path)
      } else if (paths.size) {
        const batch = [...paths]
        paths.clear()
        const previous = snapshot.value
        const documents = batch.filter(
          (path) =>
            path === 'notes' ||
            path === 'sources' ||
            path.startsWith('notes/') ||
            path.startsWith('sources/'),
        )
        if (documents.length) {
          const known = previous.accepted
            .filter((doc) => documents.some((path) => under(doc.path, path)))
            .map((doc) => doc.id)
          const delta = deltaSchema.parse(await read({ type: 'observe', paths: documents, known }))
          if (!alive) return
          const accepted = new Map(previous.accepted.map((doc) => [key(doc), doc]))
          const working = new Map(previous.working.map((doc) => [doc.path, doc]))
          const keys = new Set(delta.accepted.map(key))
          for (const [id, doc] of accepted)
            if ((known.includes(doc.id) && !keys.has(id)) || delta.removed.includes(doc.id))
              accepted.delete(id)
          for (const doc of delta.accepted) accepted.set(key(doc), doc)
          for (const path of working.keys())
            if (delta.prefixes.some((prefix) => under(path, prefix))) working.delete(path)
          for (const doc of delta.working) working.set(doc.path, doc)
          const touched = new Set([...known, ...delta.accepted.map((doc) => doc.id)])
          const value = {
            ...previous,
            accepted: [...accepted.values()],
            working: [...working.values()].sort((a, b) => a.path.localeCompare(b.path)),
            bindings: [
              ...previous.bindings.filter((entry) => !touched.has(entry.id)),
              ...delta.bindings,
            ],
            attention: delta.attention,
            retired: delta.retired ?? previous.retired,
            retiredCount: delta.retiredCount ?? previous.retiredCount,
          }
          const textChanged =
            JSON.stringify(previous.accepted.map((doc) => [doc.id, doc.path, doc.hash])) !==
              JSON.stringify(value.accepted.map((doc) => [doc.id, doc.path, doc.hash])) ||
            JSON.stringify(previous.working.map((doc) => [doc.path, doc.hash, doc.error])) !==
              JSON.stringify(value.working.map((doc) => [doc.path, doc.hash, doc.error]))
          if (textChanged) await classify(value)
          else {
            snapshot.value = value
            publish()
          }
          bindingsChanged(value)
        }
        for (const path of batch)
          for (const entry of snapshot.value?.bindings ?? [])
            for (const ref of entry.media) if (under(ref.path, path)) assets.add(ref.path)
      } else if (assets.size) {
        const batch = [...assets].slice(0, 4)
        batch.forEach((path) => assets.delete(path))
        const values = z
          .array(z.object({ path: z.string(), hash: z.string().nullable() }))
          .parse(await read({ type: 'inspect-assets', paths: batch }))
        if (!alive) return
        for (const value of values) hashes.set(value.path, value.hash)
        publish()
      }
      error.value = ''
    } catch (issue) {
      if (alive) error.value = issue as Error
      failure = issue
    } finally {
      running = false
      for (const waiter of completing) failure ? waiter.reject(failure) : waiter.resolve()
      if (alive && (full || paths.size || assets.size) && !failure) schedule()
      else {
        checking.value = false
        if (failure || !alive)
          for (const waiter of waiters.splice(0))
            failure ? waiter.reject(failure) : waiter.resolve()
      }
    }
  }
  function schedule() {
    if (alive && !timer && !running)
      timer = setTimeout(() => {
        timer = undefined
        void process()
      }, 0)
  }
  return {
    active,
    snapshot,
    changes,
    error,
    available,
    checking,
    pendingCount: computed(
      () => changes.value.filter((file) => file.status !== 'unchanged').length,
    ),
    receive(input: unknown) {
      const event = eventSchema.parse(input)
      if (!alive) return
      available.value = event.available
      if (event.full || event.paths.length + paths.size > 512) full = true
      else event.paths.forEach((path) => paths.add(path))
      schedule()
    },
    refresh() {
      if (!alive) return Promise.resolve()
      full = true
      const done = new Promise<void>((resolve, reject) => waiters.push({ resolve, reject }))
      schedule()
      return done
    },
    dispose() {
      alive = false
      checking.value = false
      clearTimeout(timer)
      inspector.dispose()
      paths.clear()
      assets.clear()
      for (const waiter of waiters.splice(0)) waiter.resolve()
    },
  }
}
export const workspaceMonitor = shallowRef<ReturnType<typeof createWorkspaceMonitor>>()
export const workspacePendingCount = computed(() => workspaceMonitor.value?.pendingCount.value ?? 0)
export const workspaceDetectionError = computed(
  () => !!workspaceMonitor.value?.error.value || workspaceMonitor.value?.available.value === false,
)

export async function connectWorkspaceMonitor(
  reader: ReturnType<typeof useLibrary>,
): Promise<() => void> {
  let stopped = false,
    generation = 0,
    unsubscribe: (() => void) | undefined
  const stop = watch(
    [reader.ready, reader.scope],
    async ([ready]) => {
      const current = ++generation
      unsubscribe?.()
      unsubscribe = undefined
      workspaceMonitor.value?.dispose()
      workspaceMonitor.value = undefined
      const active = workspaceStatus.value?.active
      if (!ready || !active || reader.scope.value !== `local:workspace:${active.id}`) return
      const monitor = createWorkspaceMonitor(active, () => reader.library.value)
      workspaceMonitor.value = monitor
      const { Channel, invoke } = await import('@tauri-apps/api/core')
      if (stopped || current !== generation) return
      const channel = new Channel<unknown>()
      channel.onmessage = (event) => {
        if (!stopped && current === generation) monitor.receive(event)
      }
      const focus = () => {
        if (document.visibilityState !== 'hidden') void monitor.refresh().catch(() => {})
      }
      window.addEventListener('focus', focus)
      document.addEventListener('visibilitychange', focus)
      let id: string | undefined
      const cleanup = () => {
        window.removeEventListener('focus', focus)
        document.removeEventListener('visibilitychange', focus)
        if (id) void invoke('workspace_unwatch', { id }).catch(() => {})
      }
      unsubscribe = cleanup
      try {
        id = await invoke<string>('workspace_watch', { token: active.token, onChange: channel })
        if (stopped || current !== generation) cleanup()
      } catch {
        monitor.available.value = false
      }
      if (!stopped && current === generation) void monitor.refresh().catch(() => {})
    },
    { immediate: true },
  )
  return () => {
    stopped = true
    generation++
    stop()
    unsubscribe?.()
    workspaceMonitor.value?.dispose()
    workspaceMonitor.value = undefined
  }
}
