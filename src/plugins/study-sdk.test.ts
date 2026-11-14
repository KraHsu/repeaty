import { describe, expect, it, vi } from 'vitest'
import type { StudyHostApi, StudyTrainingSnapshot, StudyTrainingState } from '@repeaty/plugin-api'
import { createPluginApi } from './sdk'
import type { StudyPluginIdentity } from './study'
import { default_w } from 'ts-fsrs'

function setup() {
  const disposers: (() => void)[] = [],
    callbacks: (() => void)[] = []
  let current = true
  const state: StudyTrainingState = {
    workspaceScope: 'scope-a',
    revision: 1,
    reviewCount: 0,
    decks: [],
    models: [],
    activity: { foreground: true, studying: false, idleMs: 0 },
  }
  const snapshot: StudyTrainingSnapshot = {
    workspaceScope: 'scope-a',
    token: 'owned',
    fingerprint: 'f'.repeat(64),
    modelVersion: 'FSRS-6',
    weights: [...default_w],
    retention: 0.9,
    maximumInterval: 36500,
    enableShortTerm: true,
    dayStartHour: 0,
    cutoff: '2025-01-01T00:00:00.000Z',
    createdAt: '2025-01-01T00:00:00.000Z',
    counts: { reviews: 1440, cards: 160, training: 960, validation: 320, excluded: 0 },
    histories: [],
  }
  const stop = vi.fn()
  const host = {
    trainingState: vi.fn(async () => state),
    trainingSnapshot: vi.fn(async () => snapshot),
    submitCandidate: vi.fn(async () => ({ id: 'candidate' })),
    activateModel: vi.fn(async () => {}),
    rollbackModel: vi.fn(async () => {}),
    discardTraining: vi.fn(),
    activity: vi.fn(() => state.activity),
    subscribe: vi.fn((callback: () => void) => {
      callbacks.push(callback)
      return stop
    }),
  }
  const factory = vi.fn((_identity: StudyPluginIdentity) => host as unknown as StudyHostApi)
  const api = createPluginApi(
    {
      id: 'optimizer',
      name: 'Optimizer',
      version: '1.0.0',
      apiVersion: 1,
      dataVersion: 1,
      kind: 'frontend',
    },
    'scope-a',
    disposers,
    () => current,
    undefined,
    undefined,
    undefined,
    { studyHost: () => factory },
  )
  return {
    api: api.study,
    factory,
    host,
    callbacks,
    stop,
    snapshot,
    dispose: () => disposers.forEach((fn) => fn()),
    switchScope: () => {
      current = false
    },
  }
}

describe('public study SDK lifetime', () => {
  it('binds the host exactly once so owned training tokens survive subsequent calls', async () => {
    const { api, factory, host } = setup(),
      signal = new AbortController().signal
    const snapshot = await api.trainingSnapshot({ deckId: 'deck' }, signal)
    await api.submitCandidate(
      { token: snapshot.token, weights: [...default_w], engine: 'test' },
      signal,
    )
    await api.trainingState()
    api.activity()
    expect(factory).toHaveBeenCalledOnce()
    expect(factory.mock.calls[0]![0]).toMatchObject({ pluginId: 'optimizer', scope: 'scope-a' })
    expect(host.trainingSnapshot).toHaveBeenCalledWith({ deckId: 'deck' }, signal)
    expect(host.submitCandidate).toHaveBeenCalledWith(
      { token: 'owned', weights: [...default_w], engine: 'test' },
      signal,
    )
  })
  it.each(['unload', 'switch'])('rejects a late reply and new calls after %s', async (kind) => {
    const { api, host, factory, dispose, switchScope, snapshot } = setup()
    let resolve!: (value: StudyTrainingSnapshot) => void
    host.trainingSnapshot.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done
        }),
    )
    const pending = api.trainingSnapshot(),
      failed = expect(pending).rejects.toThrow('插件已卸载或学习库已切换')
    if (kind === 'unload') dispose()
    else switchScope()
    resolve(snapshot)
    await failed
    await expect(api.trainingState()).rejects.toThrow('插件已卸载或学习库已切换')
    expect(() => api.activity()).toThrow('插件已卸载或学习库已切换')
    expect(() => factory.mock.calls[0]![0].assertCurrent()).toThrow()
    if (kind === 'unload') expect(factory.mock.calls[0]![0].signal.aborted).toBe(true)
  })
  it('stops subscriptions once and suppresses already-queued callbacks after stop/unload', () => {
    const { api, callbacks, stop, dispose } = setup(),
      listener = vi.fn()
    const unsubscribe = api.subscribe(listener)
    callbacks[0]!()
    expect(listener).toHaveBeenCalledOnce()
    unsubscribe()
    unsubscribe()
    dispose()
    expect(stop).toHaveBeenCalledOnce()
    expect(() => callbacks[0]!()).not.toThrow()
    expect(listener).toHaveBeenCalledOnce()
  })
  it('suppresses old callbacks when the library changes without reusing an old subscription', () => {
    const { api, callbacks, switchScope } = setup(),
      listener = vi.fn()
    api.subscribe(listener)
    switchScope()
    expect(() => callbacks[0]!()).not.toThrow()
    expect(listener).not.toHaveBeenCalled()
  })
  it('has a clear capability failure on an older host', async () => {
    const api = createPluginApi(
      {
        id: 'old-host-test',
        name: 'Test',
        version: '1.0.0',
        apiVersion: 1,
        dataVersion: 1,
        kind: 'frontend',
      },
      'scope',
      [],
    )
    await expect(api.study.trainingState()).rejects.toThrow('study-service-unavailable')
  })
})
