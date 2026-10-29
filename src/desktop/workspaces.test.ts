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
})
