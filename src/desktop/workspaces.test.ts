import { afterEach, describe, expect, it, vi } from 'vitest'
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke }))
afterEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})
const active = () => ({ id: crypto.randomUUID(), token: crypto.randomUUID(), path: '/my/学习库' })
const status = (value: ReturnType<typeof active> | null) => ({
  epoch: crypto.randomUUID(),
  active: value,
  recent: [],
  error: null,
})
describe('desktop workspace lifecycle', () => {
  it('flushes editor work before freezing native writes and refuses a failed or stale leave guard', async () => {
    const selected = active(),
      reload = vi.fn()
    vi.stubGlobal('window', { location: { reload } })
    invoke.mockImplementation(async (command) =>
      command === 'workspace_status'
        ? status(selected)
        : command === 'workspace_read'
          ? {}
          : status(null),
    )
    const store = await import('./workspaces')
    await store.initializeWorkspaces()
    let allow = false
    const stop = store.connectWorkspaceLeaveGuard(async () => {
      await store.workspaceApi('workspace_write', {
        token: selected.token,
        request: { type: 'draft' },
      })
      return allow
    })
    await store.closeWorkspace()
    expect(invoke).toHaveBeenCalledWith('workspace_write', expect.anything())
    expect(invoke.mock.calls.some(([name]) => name === 'workspace_close')).toBe(false)
    expect(reload).not.toHaveBeenCalled()
    allow = true
    await store.closeWorkspace()
    expect(invoke.mock.calls.filter(([name]) => name === 'workspace_close')).toHaveLength(1)
    expect(reload).toHaveBeenCalledOnce()
    stop()
  })
  it('does not close a new native session after an old guard resolves or is removed', async () => {
    const reload = vi.fn()
    vi.stubGlobal('window', { location: { reload } })
    invoke.mockResolvedValue(status(null))
    const store = await import('./workspaces')
    await store.initializeWorkspaces()
    for (const invalidate of ['scope', 'dispose']) {
      let finish!: (value: boolean) => void
      const stop = store.connectWorkspaceLeaveGuard(
        () =>
          new Promise<boolean>((resolve) => {
            finish = resolve
          }),
      )
      const closing = store.closeWorkspace()
      if (invalidate === 'scope') store.workspaceStatus.value = status(active())
      else stop()
      finish(true)
      await closing
      stop()
    }
    expect(invoke.mock.calls.some(([name]) => name === 'workspace_close')).toBe(false)
    expect(reload).not.toHaveBeenCalled()
  })
  it('binds an explicit settings save to its original token and waits for durable completion', async () => {
    const selected = active()
    let finish!: () => void
    invoke.mockImplementation(async (command) =>
      command === 'workspace_status'
        ? status(selected)
        : command === 'workspace_read'
          ? {}
          : command === 'workspace_write'
            ? new Promise<void>((resolve) => {
                finish = resolve
              })
            : null,
    )
    const store = await import('./workspaces')
    store.installWorkspaceStores()
    await store.initializeWorkspaces()
    const settings = await import('../settings-store')
    const saved = vi.fn()
    const writing = settings.persistSetting('synonyms', '记忆, memory').then(saved)
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    expect(saved).not.toHaveBeenCalled()
    expect(settings.readSetting('synonyms')).toBeNull()
    finish()
    await writing
    expect(settings.readSetting('synonyms')).toBe('记忆, memory')
    invoke.mockClear()
    const changing = settings.persistSetting('synonyms', 'old library')
    const rejected = expect(changing).rejects.toThrow()
    store.workspaceStatus.value = status(active())
    await rejected
    expect(invoke).not.toHaveBeenCalledWith('workspace_write', expect.anything())
    expect(settings.readSetting('synonyms')).toBe('记忆, memory')
  })
  it('uses a visible empty state without opening browser storage', async () => {
    const forbidden = vi.fn(() => {
      throw Error('Browser persistence must not be used')
    })
    vi.stubGlobal('localStorage', { getItem: forbidden, setItem: forbidden })
    invoke.mockResolvedValue(status(null))
    const store = await import('./workspaces')
    store.installWorkspaceStores()
    await store.initializeWorkspaces()
    expect(store.workspaceAvailable.value).toBe(false)
    expect(store.workspaceLoading.value).toBe(false)
    await expect(store.currentWorkspace()).rejects.toThrow()
    expect(forbidden).not.toHaveBeenCalled()
    expect(invoke.mock.calls.map((call) => call[0])).toEqual(['workspace_status'])
  })
  it('hydrates only the selected workspace settings and rejects plugin data from another identity', async () => {
    const selected = active()
    invoke.mockImplementation(async (command) =>
      command === 'workspace_status'
        ? status(selected)
        : command === 'workspace_read'
          ? { 'repeaty.locale': 'en' }
          : null,
    )
    const store = await import('./workspaces')
    store.installWorkspaceStores()
    await store.initializeWorkspaces()
    const settings = await import('../settings-store')
    expect(settings.readSetting('repeaty.locale')).toBe('en')
    settings.writeSetting('repeaty.locale', 'zh-CN')
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('workspace_write', {
        token: selected.token,
        request: { type: 'value', namespace: 'settings', id: 'repeaty.locale', value: 'zh-CN' },
      }),
    )
    const { createPluginApi } = await import('../plugins/sdk')
    const api = createPluginApi(
      {
        id: 'example',
        name: 'Example',
        version: '1.0.0',
        apiVersion: 1,
        dataVersion: 1,
        kind: 'frontend',
      },
      'local:workspace:' + selected.id,
      [],
    )
    await expect(
      api.pluginData.get('card', 'local:workspace:' + crypto.randomUUID()),
    ).rejects.toThrow()
    expect(
      invoke.mock.calls.filter(
        ([name, args]) => name === 'workspace_read' && args.request.type === 'value',
      ),
    ).toHaveLength(0)
  })
  it('waits for pending writes before changing the directory and revokes queued new work', async () => {
    const selected = active()
    let finish!: () => void
    const reload = vi.fn()
    vi.stubGlobal('window', { location: { reload } })
    invoke.mockImplementation(async (command) =>
      command === 'workspace_status'
        ? status(selected)
        : command === 'workspace_read'
          ? {}
          : command === 'workspace_write'
            ? new Promise<void>((resolve) => {
                finish = resolve
              })
            : status(null),
    )
    const store = await import('./workspaces')
    store.installWorkspaceStores()
    await store.initializeWorkspaces()
    const writing = store.workspaceApi('workspace_write', {
      token: selected.token,
      request: { type: 'backup' },
    })
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    const closing = store.closeWorkspace()
    expect(invoke.mock.calls.some(([name]) => name === 'workspace_close')).toBe(false)
    await expect(store.workspaceApi('workspace_write', {})).rejects.toThrow()
    finish()
    await writing
    await closing
    expect(reload).toHaveBeenCalledOnce()
  })
  it('cancelling or failing a native picker keeps the existing session usable', async () => {
    const selected = active()
    const reload = vi.fn()
    vi.stubGlobal('window', { location: { reload } })
    invoke.mockImplementation(async (command) =>
      command === 'workspace_status' ? status(selected) : command === 'workspace_read' ? {} : null,
    )
    const store = await import('./workspaces')
    store.installWorkspaceStores()
    await store.initializeWorkspaces()
    await store.chooseWorkspace('open')
    expect(reload).not.toHaveBeenCalled()
    invoke.mockRejectedValueOnce('workspace-not-empty')
    await expect(store.chooseWorkspace('create')).rejects.toThrow()
    await expect(
      store.workspaceApi('workspace_read', {
        token: selected.token,
        request: { type: 'settings' },
      }),
    ).resolves.toEqual({})
    expect(store.workspaceStatus.value?.active).toEqual(selected)
  })
  it('serializes a sync settings refresh with durable writes so a late read cannot overwrite new values', async () => {
    const selected = active()
    invoke.mockImplementation(async (command) =>
      command === 'workspace_status' ? status(selected) : {},
    )
    const store = await import('./workspaces')
    store.installWorkspaceStores()
    await store.initializeWorkspaces()
    const settings = await import('../settings-store')
    let finishRead!: (value: Record<string, string>) => void
    invoke.mockImplementation(async (command) =>
      command === 'workspace_read'
        ? new Promise<Record<string, string>>((resolve) => {
            finishRead = resolve
          })
        : undefined,
    )
    const reading = store.hydrateSettings()
    await vi.waitFor(() => expect(finishRead).toBeTypeOf('function'))
    const writing = settings.persistSetting('plugin:sample:config', 'new value')
    await vi.waitFor(() =>
      expect(invoke.mock.calls.filter(([command]) => command === 'workspace_write')).toHaveLength(
        1,
      ),
    )
    finishRead({ 'plugin:sample:config': 'old value' })
    await Promise.all([reading, writing])
    expect(settings.readSetting('plugin:sample:config')).toBe('new value')
    expect(invoke).toHaveBeenCalledWith(
      'workspace_write',
      expect.objectContaining({ token: selected.token }),
    )
  })
})
