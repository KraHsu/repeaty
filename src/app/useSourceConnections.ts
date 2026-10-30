import { computed, onScopeDispose, ref, shallowRef, watch } from 'vue'
import type { useLibrary } from '../composables/useLibrary'
import type { usePluginManager } from '../plugins/manager'
import type {
  SourceConnectorContribution,
  SourceConnectorItem,
  SourceConnectorSnapshot,
  SourceDirectory,
} from '@repeaty/plugin-api'
import type { SourceConnection } from '../core/collection-data'
import * as platform from '@repeaty-collection-platform'
import { inspectCollectionPath } from '../core/collection-input'
import type { DirectoryEntry } from '../desktop/collection'
import { createExportFile } from '@repeaty-platform'

export function useSourceConnections(
  workspace: ReturnType<typeof useLibrary>,
  plugins: ReturnType<typeof usePluginManager>,
) {
  const api = computed(() => {
    const scope = workspace.scope.value
    return workspace.ready.value && scope ? workspace.sourceConnectionApi() : undefined
  })
  const connectors = computed<(SourceConnectorContribution & { pluginId: string })[]>(() => [
    {
      pluginId: 'repeaty-directory',
      id: 'text-directory',
      title: 'Markdown / 文本目录',
      kind: 'directory' as const,
      scan: () => Promise.reject(new Error('host-owned')),
    },
    ...plugins.pluginRuntime.installations.flatMap((installation) =>
      (installation.connectors ?? []).map((c) => ({ ...c, pluginId: installation.plugin.id })),
    ),
  ])
  const connections = computed(() => workspace.library.value.sourceConnections)
  const candidates = computed(() =>
    workspace.library.value.sourceCandidates.filter((c) => !c.dismissed),
  )
  const running = ref<string[]>([]),
    error = ref(''),
    progress = ref('')
  const directories = shallowRef(new Map<string, SourceDirectory>()),
    controllers = new Map<string, AbortController>(),
    attempted = new Map<string, number>()
  const originals = shallowRef(new Map<string, NonNullable<SourceConnectorItem['original']>>())
  const availableGrants = shallowRef<Set<string>>(),
    failedDirectories = shallowRef(new Set<string>())
  let alive = true
  function requiresDirectory(connection: SourceConnection) {
    const provider = connectors.value.find(
      (c) => c.pluginId === connection.pluginId && c.id === connection.connectorId,
    )
    return (
      connection.mode === 'index' ||
      provider?.kind === 'directory' ||
      connection.settings.input === 'directory'
    )
  }
  const needsAuthorization = computed(() =>
    connections.value
      .filter((connection) => {
        if (connection.status !== 'connected' || !requiresDirectory(connection)) return false
        if (failedDirectories.value.has(connection.id)) return true
        if (directories.value.has(connection.id)) return false
        if (!platform.nativeCollection || typeof connection.settings.directoryId !== 'string')
          return true
        return (
          !!availableGrants.value && !availableGrants.value.has(connection.settings.directoryId)
        )
      })
      .map((connection) => connection.id),
  )
  async function refreshDirectoryAccess() {
    if (!platform.nativeCollection || !workspace.ready.value) return
    const scope = workspace.scope.value
    try {
      const grants = await platform.directoryConnections(scope)
      assertScope(scope)
      availableGrants.value = new Set(grants.filter((g) => g.available).map((g) => g.id))
    } catch {
      /* A library may still be binding its native session. Retry on focus or scan. */
    }
  }
  const key = (connectionId: string, itemKey: string) => JSON.stringify([connectionId, itemKey])
  function reset() {
    for (const controller of controllers.values()) controller.abort()
    controllers.clear()
    directories.value = new Map()
    availableGrants.value = undefined
    failedDirectories.value = new Set()
    attempted.clear()
    originals.value = new Map()
    running.value = []
    error.value = ''
    progress.value = ''
  }
  watch(workspace.scope, reset, { flush: 'sync' })
  watch(
    () =>
      `${workspace.scope.value}:${workspace.ready.value}:${connections.value.map((c) => `${c.id}:${c.settings.directoryId}:${c.status}`).join('|')}`,
    () => void refreshDirectoryAccess(),
    { immediate: true, flush: 'post' },
  )
  function assertScope(scope: string) {
    if (!alive || workspace.scope.value !== scope || !workspace.ready.value)
      throw new Error('学习库已变化。')
  }
  async function chooseDirectory(existingId?: string) {
    if (!platform.nativeCollection) throw new Error('请使用“选择目录”上传控件授权浏览器读取。')
    const scope = workspace.scope.value
    const chosen = await platform.directoryChoose(scope, existingId)
    assertScope(scope)
    if (chosen) availableGrants.value = new Set([...(availableGrants.value ?? []), chosen.id])
    return chosen
  }
  function browserDirectory(files: readonly File[]): SourceDirectory {
    const indexed = new Map<string, File>()
    let bytes = 0
    for (const file of files) {
      const relative = file.webkitRelativePath
      const path =
        relative && relative.includes('/') ? relative.slice(relative.indexOf('/') + 1) : file.name
      if ('reason' in inspectCollectionPath(path)) continue
      if (indexed.has(path)) throw new Error('目录存在重复路径。')
      indexed.set(path, file)
      bytes += file.size
    }
    if (indexed.size > 10000 || bytes > 256 * 1024 * 1024)
      throw new Error('目录超过 10000 个文件或 256 MB，请缩小范围。')
    return {
      files: [...indexed].map(([path, file]) => ({
        path,
        size: file.size,
        modified: String(file.lastModified),
      })),
      async read(path) {
        const file = indexed.get(path)
        if (!file) throw new Error('文件已不存在。')
        return file
      },
    }
  }
  async function save(input: {
    id?: string
    pluginId: string
    connectorId: string
    title: string
    mode: 'import' | 'index'
    directoryId?: string
    files?: readonly File[]
    settings?: Record<string, unknown>
    intervalHours?: SourceConnection['intervalHours']
    status?: SourceConnection['status']
  }) {
    const owner = api.value,
      scope = workspace.scope.value
    if (!owner) throw new Error('请先打开学习库。')
    const { files, directoryId, ...rest } = input,
      selected = files ? browserDirectory(files) : undefined
    const result = await owner.save({
      ...rest,
      settings: { ...input.settings, ...(directoryId ? { directoryId } : {}) },
      expectedRevision: owner.snapshot().revision,
    })
    assertScope(scope)
    controllers.get(result.id)?.abort()
    if (selected) directories.value = new Map(directories.value).set(result.id, selected)
    const failures = new Set(failedDirectories.value)
    failures.delete(result.id)
    failedDirectories.value = failures
    return result
  }
  async function readDirectory(
    connection: SourceConnection,
    signal: AbortSignal,
  ): Promise<SourceDirectory> {
    const chosen = directories.value.get(connection.id)
    if (chosen) return chosen
    const scope = workspace.scope.value,
      id = connection.settings.directoryId
    if (!platform.nativeCollection || typeof id !== 'string')
      throw new Error('此设备尚未授权来源目录，请重新关联目录。')
    const listing = await platform.directoryList(scope, id, signal)
    assertScope(scope)
    signal.throwIfAborted()
    if (listing.skipped.some((entry) => entry.reason === 'file-too-large'))
      throw new Error('目录中有文件超过读取限制，本次检查未完成；已保存的材料保持不变。')
    const entries = new Map(listing.files.map((entry) => [entry.path, entry]))
    return {
      files: listing.files,
      async read(path) {
        signal.throwIfAborted()
        const entry = entries.get(path)
        if (!entry) throw new Error('文件不在这次目录快照中。')
        const content = await platform.directoryRead(scope, id, entry, signal)
        assertScope(scope)
        signal.throwIfAborted()
        return new Blob([Uint8Array.from(content.bytes)], { type: mime(path) })
      },
    }
  }
  async function scan(id: string) {
    const owner = api.value,
      scope = workspace.scope.value,
      connection = connections.value.find((c) => c.id === id)
    if (!owner || !connection || connection.status !== 'connected')
      throw new Error('来源尚未连接。')
    if (controllers.has(id)) return
    const controller = new AbortController()
    controllers.set(id, controller)
    running.value = [...controllers.keys()]
    attempted.set(id, Date.now())
    error.value = ''
    try {
      if (connection.mode === 'index') {
        if (!platform.nativeCollection || typeof connection.settings.directoryId !== 'string')
          throw new Error('只读索引需要桌面目录授权。')
        await platform.directoryIndex(scope, connection.settings.directoryId, controller.signal)
        assertScope(scope)
        controller.signal.throwIfAborted()
        await owner.markChecked({ connectionId: id, generation: connection.generation })
        progress.value = '只读目录索引已更新。'
        return
      }
      const selected = connectors.value.find(
        (c) => c.pluginId === connection.pluginId && c.id === connection.connectorId,
      )
      if (!selected) throw new Error('请在插件页面安装并启用来源插件。')
      const directory =
        selected.kind === 'directory' ||
        (selected.kind === 'hybrid' && connection.settings.input === 'directory')
          ? await readDirectory(connection, controller.signal)
          : undefined
      const snapshot =
        connection.pluginId === 'repeaty-directory'
          ? await scanTextDirectory(directory!, controller.signal)
          : await plugins.scanSourceConnector(
              connection.pluginId,
              connection.connectorId,
              {
                connectionId: id,
                settings: connection.settings,
                cursor: connection.cursor,
                directory,
              },
              {
                signal: controller.signal,
                onProgress: (value) => {
                  if (workspace.scope.value === scope)
                    progress.value =
                      value.message ??
                      `正在读取 ${value.completed}${value.total ? ` / ${value.total}` : ''}`
                },
              },
            )
      assertScope(scope)
      controller.signal.throwIfAborted()
      await owner.stage(
        { connectionId: id, generation: connection.generation, snapshot },
        controller.signal,
      )
      assertScope(scope)
      const next = new Map(originals.value)
      for (const originalKey of next.keys()) {
        const [connectionKey, itemKey] = JSON.parse(originalKey) as [string, string]
        if (connectionKey === id && (snapshot.complete || snapshot.deletedKeys?.includes(itemKey)))
          next.delete(originalKey)
      }
      for (const item of snapshot.items)
        if (item.original) next.set(key(id, item.key), item.original)
      originals.value = next
      progress.value = '检查完成，请确认发现的变化。'
    } catch (reason) {
      if (
        !controller.signal.aborted &&
        workspace.scope.value === scope &&
        requiresDirectory(connection)
      ) {
        const message = String(reason instanceof Error ? reason.message : reason)
        if (
          /source-(grant-missing|unavailable|permission)|permission-denied|尚未授权/.test(message)
        )
          failedDirectories.value = new Set(failedDirectories.value).add(id)
      }
      if (!controller.signal.aborted && workspace.scope.value === scope)
        error.value = String(reason instanceof Error ? reason.message : reason)
      throw reason
    } finally {
      if (controllers.get(id) === controller) controllers.delete(id)
      if (workspace.scope.value === scope) running.value = [...controllers.keys()]
    }
  }
  async function disconnect(id: string) {
    const scope = workspace.scope.value,
      owner = api.value,
      connection = connections.value.find((c) => c.id === id)
    if (!owner || !connection) return
    controllers.get(id)?.abort()
    await owner.save({
      ...connection,
      status: 'disconnected',
      expectedRevision: owner.snapshot().revision,
    })
    assertScope(scope)
    const remaining = new Map(directories.value)
    remaining.delete(id)
    directories.value = remaining
    originals.value = new Map([...originals.value].filter(([entry]) => JSON.parse(entry)[0] !== id))
    if (platform.nativeCollection && typeof connection.settings.directoryId === 'string')
      await platform.directoryDisconnect(scope, connection.settings.directoryId)
  }
  async function searchIndex(id: string, query: string) {
    const scope = workspace.scope.value,
      connection = connections.value.find((c) => c.id === id)
    if (
      !connection ||
      connection.status !== 'connected' ||
      connection.mode !== 'index' ||
      typeof connection.settings.directoryId !== 'string'
    )
      throw new Error('目录索引尚未连接。')
    const result = await platform.directorySearch(scope, connection.settings.directoryId, query, 50)
    assertScope(scope)
    return result
  }
  async function readIndexed(id: string, entry: DirectoryEntry) {
    const scope = workspace.scope.value,
      connection = connections.value.find((c) => c.id === id)
    if (
      !connection ||
      connection.status !== 'connected' ||
      connection.mode !== 'index' ||
      typeof connection.settings.directoryId !== 'string'
    )
      throw new Error('目录索引尚未连接。')
    const result = await platform.directoryRead(scope, connection.settings.directoryId, entry)
    assertScope(scope)
    return new TextDecoder('utf-8', { fatal: true }).decode(result.bytes)
  }
  async function exportOriginal(id: string, itemKey: string) {
    const scope = workspace.scope.value,
      connection = connections.value.find((c) => c.id === id),
      original = originals.value.get(key(id, itemKey))
    if (!connection || connection.status !== 'connected' || !original)
      throw new Error('请先重新检查来源，以获取有效的原件位置。')
    let blob: Blob
    if (original.path) {
      const directory = await readDirectory(connection, new AbortController().signal)
      blob = await directory.read(original.path)
    } else {
      if (!platform.nativeCollection) throw new Error('在线原件下载需要桌面版。')
      const result = await platform.downloadOriginal(scope, {
        url: original.url!,
        filename: original.name,
        format: original.format,
      })
      if (!result) return
      blob = new Blob([Uint8Array.from(result.bytes)], { type: result.type })
    }
    assertScope(scope)
    const filename = original.name.replace(/[\\/:\u0000-\u001f]/g, '_')
    if (!createExportFile) {
      const url = URL.createObjectURL(blob),
        link = document.createElement('a')
      link.href = url
      link.download = filename
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      return
    }
    const stream = await createExportFile(filename),
      writer = stream.getWriter()
    try {
      assertScope(scope)
      await writer.write(new Uint8Array(await blob.arrayBuffer()))
      await writer.close()
    } catch (reason) {
      await writer.abort(reason).catch(() => {})
      throw reason
    }
  }
  async function schedule() {
    if (!alive || !workspace.ready.value) return
    for (const connection of connections.value) {
      if (
        connection.status !== 'connected' ||
        !connection.intervalHours ||
        controllers.has(connection.id) ||
        needsAuthorization.value.includes(connection.id)
      )
        continue
      const last = Math.max(
        attempted.get(connection.id) ?? 0,
        Date.parse(connection.checkedAt ?? '') || 0,
      )
      if (Date.now() - last < connection.intervalHours * 3600_000) continue
      void scan(connection.id).catch(() => {})
    }
  }
  const timer = setInterval(() => void schedule(), 60_000)
  const focus = () => {
    void refreshDirectoryAccess()
    void schedule()
  }
  window.addEventListener('focus', focus)
  onScopeDispose(() => {
    alive = false
    clearInterval(timer)
    window.removeEventListener('focus', focus)
    reset()
  })
  return {
    api,
    connectors,
    connections,
    candidates,
    running,
    error,
    progress,
    originals,
    needsAuthorization,
    native: platform.nativeCollection,
    chooseDirectory,
    save,
    scan,
    disconnect,
    cancel: (id: string) => controllers.get(id)?.abort(),
    readDirectory,
    searchIndex,
    readIndexed,
    exportOriginal,
  }
}
function mime(path: string) {
  const extension = path.split('.').at(-1)?.toLowerCase()
  return (
    (
      {
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        gif: 'image/gif',
        webp: 'image/webp',
        svg: 'image/svg+xml',
        mp3: 'audio/mpeg',
        ogg: 'audio/ogg',
        wav: 'audio/wav',
        pdf: 'application/pdf',
        epub: 'application/epub+zip',
        md: 'text/markdown',
        txt: 'text/plain',
      } as Record<string, string>
    )[extension ?? ''] ?? 'application/octet-stream'
  )
}
async function scanTextDirectory(
  directory: SourceDirectory,
  signal: AbortSignal,
): Promise<SourceConnectorSnapshot> {
  const files = directory.files.filter((file) => /\.(md|markdown|txt)$/i.test(file.path))
  if (files.length > 1000) throw new Error('一次最多检查 1000 份材料，请按子目录连接。')
  const items: SourceConnectorItem[] = []
  for (const file of files) {
    signal.throwIfAborted()
    if (file.size > 1024 * 1024) throw new Error(`${file.path} 超过 1 MB。`)
    const blob = await directory.read(file.path),
      text = new TextDecoder('utf-8', { fatal: true }).decode(await blob.arrayBuffer())
    if (!text.trim())
      throw new Error(`${file.path}：文件暂时为空，本次检查未完成，请保存正文后重试。`)
    items.push({
      key: file.path,
      path: file.path,
      title: file.path
        .split('/')
        .at(-1)!
        .replace(/\.[^.]+$/, ''),
      text,
      format: /\.txt$/i.test(file.path) ? 'plain' : 'markdown',
    })
  }
  return { items, complete: true }
}
